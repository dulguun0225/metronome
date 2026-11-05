import { PROCESSOR_NAME, type Level, type NoteReport, type Position, type ProcessorMessage, type ProcessorOptions, type Settings } from "./clickGenerator";
import workletCode from "./clickWorklet.ts?worklet";
import { REFRESH_INTERVAL_FRAMES, refreshInterval } from "./refreshInterval";

export { nextPosition, type BeatSettings, type Level, type Position, type Settings } from "./clickGenerator";

// Every level, from lowest to highest.
export const LEVELS: readonly Level[] = ["mute", "normal", "accent", "maxAccent"];

// The level for a pointer `y` px below the top of a subdivision cell `height` px tall. The cell is
// split into four equal bands, max accent at the top and mute at the bottom; a band's top edge belongs
// to it. Positions above the cell give max accent, positions below it mute.
export function levelAtPosition(y: number, height: number): Level {
  if (!(height > 0) || Number.isNaN(y)) return "mute";
  const fromTop = Math.min(LEVELS.length - 1, Math.max(0, Math.floor((y / height) * LEVELS.length)));
  return LEVELS[LEVELS.length - 1 - fromTop];
}

// Time constant of master volume changes, so a change during a click does not make it crackle.
const VOLUME_TIME_CONSTANT = 0.01;
// Stop fades the run's output out with this time constant, then disconnects it after STOP_DISCONNECT_MS,
// when the gain is below 1e-3 of its value, so a click cut mid-envelope does not pop.
const STOP_TIME_CONSTANT = 0.002;
const STOP_DISCONNECT_MS = 15;

// Audio Session API (Safari): the "playback" type makes audio play with the iPhone silent switch on.
interface AudioSessionNavigator {
  audioSession?: { type: string };
}

function setAudioSessionToPlayback() {
  const session = (navigator as Navigator & AudioSessionNavigator).audioSession;
  if (!session) return;
  try {
    session.type = "playback";
  } catch {
    // Not settable here; audio plays with the default type.
  }
}

// The worklet module as a data: URL. Chromium does not load a worklet module from a Blob URL on a
// file:// page (an opaque origin), but loads a data: URL there as on http(s).
const WORKLET_URL = `data:text/javascript,${encodeURIComponent(workletCode)}`;

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// How much later than performance.now() an output timestamp's performanceTime may be, in ms, from the
// reduced precision of both.
const TIMESTAMP_TOLERANCE_MS = 1;

// The context time of the audio at the output device now, by what the browser reports, or null when it
// reports nothing usable. currentTime is the time of the audio being rendered, which plays later.
// getOutputTimestamp() gives the time of the frame at the output device (contextTime) and the
// performance.now() time it was there (performanceTime), both 0 before the first render; Chromium
// updates it once per device callback, so it is extrapolated to now. Firefox reports contextTime as
// currentTime - outputLatency but also moves performanceTime back by outputLatency, so the
// extrapolation gives currentTime there; the bound of currentTime - outputLatency keeps the latency.
// WebKit (WPE WebKit 27.2) reports a performanceTime later than now by about the context time, which
// would keep the time near 0, so a timestamp later than now is not used.
// Without a timestamp, the time is currentTime - baseLatency - outputLatency, missing values taken as 0.
function reportedHeardTime(ctx: AudioContext): number | null {
  const now = ctx.currentTime;
  const base = isTime(ctx.baseLatency) ? ctx.baseLatency : null;
  const output = isTime(ctx.outputLatency) ? ctx.outputLatency : null;
  const stamp = typeof ctx.getOutputTimestamp === "function" ? ctx.getOutputTimestamp() : null;
  const performanceNow = performance.now();
  if (
    stamp &&
    isTime(stamp.contextTime) &&
    isTime(stamp.performanceTime) &&
    stamp.contextTime > 0 &&
    stamp.performanceTime > 0 &&
    stamp.performanceTime <= performanceNow + TIMESTAMP_TOLERANCE_MS
  ) {
    const extrapolated = stamp.contextTime + (performanceNow - stamp.performanceTime) / 1000;
    return Math.min(extrapolated, now - (output ?? 0));
  }
  if (base === null && output === null) return null;
  return now - (base ?? 0) - (output ?? 0);
}

// The audio nodes of one run, from start to stop. The click node is null until the worklet module has loaded.
interface Run {
  output: GainNode;
  node: AudioWorkletNode | null;
}

// Plays the clicks from an AudioWorklet (clickWorklet.ts), which reports every note it starts; an
// animation frame loop shows each note on the frame nearest to the time its onset is heard.
export class Metronome {
  #settings: Settings;
  #onActive: (pos: Position | null) => void;
  #ctx: AudioContext | null = null;
  // Loading of the worklet module into #ctx; resolves to false when it failed.
  #module: Promise<boolean> | undefined;
  #run: Run | null = null;
  #volume = 1;
  // Manual output delay in seconds, or null to use the delay the browser reports.
  #outputDelay: number | null = null;
  #frame: number | undefined;
  // Times requestAnimationFrame passed to the latest #draw calls, oldest first, to estimate the display
  // refresh interval. Kept across runs, so a restart has an estimate at once; the difference across a stop
  // and start is long like that of skipped frames, or short like that of a frame run early, and the
  // estimate allows for both.
  #frameTimes: number[] = [];
  // Reported notes not yet shown, in time order. Notes also arrive while no animation frame runs (a hidden
  // page), so of the notes the heard time has reached, only the latest is kept.
  #queue: NoteReport[] = [];

  // `settings` must be plain data, as it is copied to the audio thread.
  constructor(settings: Settings, onActive: (pos: Position | null) => void) {
    this.#settings = settings;
    this.#onActive = onActive;
  }

  // Must be called from a user gesture the first time, so the AudioContext may start.
  start() {
    this.stop();
    setAudioSessionToPlayback();
    this.#ctx ??= new AudioContext();
    const ctx = this.#ctx;
    void ctx.resume();
    // A fresh output node per run, so stop() can fade out the clicks sounding. Its gain is the master volume.
    const output = ctx.createGain();
    output.gain.value = this.#volume;
    output.connect(ctx.destination);
    const run: Run = { output, node: null };
    this.#run = run;
    // The click node is created once the module has loaded, unless the run has stopped by then.
    this.#module ??= this.#loadModule(ctx);
    void this.#module.then((loaded) => {
      if (loaded && this.#run === run) this.#startClicks(ctx, run);
    });
    this.#frame = requestAnimationFrame(this.#draw);
  }

  stop() {
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
    const ctx = this.#ctx;
    const run = this.#run;
    if (ctx && run) {
      // The worklet starts no further notes; the clicks sounding fade out. Volume changes use
      // setTargetAtTime from the current time too, so this later event takes over from them.
      run.output.gain.setTargetAtTime(0, ctx.currentTime, STOP_TIME_CONSTANT);
      setTimeout(() => run.output.disconnect(), STOP_DISCONNECT_MS);
      if (run.node) {
        run.node.port.onmessage = null;
        run.node.port.postMessage({ type: "stop" } satisfies ProcessorMessage);
      }
    }
    this.#run = null;
    this.#queue = [];
    this.#onActive(null);
  }

  // Applies from the next note that has not started, also during playback. `settings` must be plain data.
  setSettings(settings: Settings) {
    this.#settings = settings;
    this.#run?.node?.port.postMessage({ type: "settings", settings } satisfies ProcessorMessage);
  }

  // Master volume, 0 to 1; applies at once, also during playback.
  setVolume(volume: number) {
    this.#volume = volume;
    if (this.#ctx && this.#run) this.#run.output.gain.setTargetAtTime(volume, this.#ctx.currentTime, VOLUME_TIME_CONSTANT);
  }

  // Delay in seconds from rendering a note to showing it, or null for the delay the browser reports.
  setOutputDelay(seconds: number | null) {
    this.#outputDelay = seconds;
  }

  // The output delay the browser reports, in seconds, or null when it reports none or before the first start.
  reportedOutputDelay(): number | null {
    const ctx = this.#ctx;
    const heard = ctx ? reportedHeardTime(ctx) : null;
    return ctx && heard !== null ? Math.max(0, ctx.currentTime - heard) : null;
  }

  dispose() {
    this.stop();
    void this.#ctx?.close();
    this.#ctx = null;
    this.#module = undefined;
  }

  #loadModule(ctx: AudioContext): Promise<boolean> {
    const loading = ctx.audioWorklet.addModule(WORKLET_URL).then(
      () => true,
      (error: unknown) => {
        console.error("Loading the click AudioWorklet failed", error);
        // The next start tries again.
        if (this.#module === loading) this.#module = undefined;
        return false;
      },
    );
    return loading;
  }

  #startClicks(ctx: AudioContext, run: Run) {
    const processorOptions: ProcessorOptions = { settings: this.#settings };
    const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, { numberOfInputs: 0, outputChannelCount: [1], processorOptions });
    node.port.onmessage = (e: MessageEvent<NoteReport[]>) => {
      this.#queue.push(...e.data);
      // Without lookahead, the latest note kept is never later than the note the next frame shows, as that
      // frame looks ahead by 0 or more from the same or a later heard time.
      const reached = this.#reachedCount(ctx, 0);
      if (reached > 1) this.#queue.splice(0, reached - 1);
    };
    node.connect(run.output);
    run.node = node;
  }

  // Number of queued notes whose onsets are heard within `lookahead` seconds from now. The audio heard now
  // is the audio at currentTime less the manual output delay, or at the time the browser reports.
  #reachedCount(ctx: AudioContext, lookahead: number): number {
    const heard = this.#outputDelay !== null ? ctx.currentTime - this.#outputDelay : (reportedHeardTime(ctx) ?? ctx.currentTime);
    let count = 0;
    while (count < this.#queue.length && this.#queue[count].time <= heard + lookahead) count++;
    return count;
  }

  // Arrow function so it can be passed to requestAnimationFrame directly.
  #draw = (time: number) => {
    const ctx = this.#ctx;
    if (!ctx) return;
    this.#frameTimes.push(time);
    if (this.#frameTimes.length > REFRESH_INTERVAL_FRAMES + 1) this.#frameTimes.shift();
    // The latest note heard within half a refresh interval is shown, so each note appears on the frame
    // nearest to the time its onset is heard, not on the first frame after it (half an interval late on
    // average). Until the interval is estimated, there is no lookahead. Older notes are dropped.
    const reached = this.#reachedCount(ctx, refreshInterval(this.#frameTimes) / 2000);
    if (reached > 0) {
      const current = this.#queue[reached - 1];
      this.#queue.splice(0, reached);
      this.#onActive({ beat: current.beat, sub: current.sub });
    }
    this.#frame = requestAnimationFrame(this.#draw);
  };
}
