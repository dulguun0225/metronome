// How a subdivision sounds: not at all, or with a click of rising pitch and gain.
export type Level = "mute" | "normal" | "accent" | "maxAccent";

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

export interface BeatSettings {
  subDivision: number;
  // One level per possible subdivision; only the first `subDivision` levels are used.
  levels: Level[];
}

export interface Position {
  beat: number;
  sub: number;
}

export interface Settings {
  tempo: number;
  beatCount: number;
  beats: readonly BeatSettings[];
}

interface ScheduledNote extends Position {
  time: number;
}

// Scheduler timing, in seconds unless noted.
const TICK_MS = 25;
const LOOKAHEAD = 0.1;
const START_DELAY = 0.05;

// Click sound. Peak gain of each click, relative to the master volume.
const ATTACK = 0.002;
const DECAY = 0.04;
const MAX_ACCENT_GAIN = 1;
const ACCENT_GAIN = 0.7;
const NORMAL_GAIN = 0.5;
// Time constant of master volume changes, so a change during a click does not make it crackle.
const VOLUME_TIME_CONSTANT = 0.01;
// Stop fades the run's output out with this time constant, then disconnects it after STOP_DISCONNECT_MS,
// when the gain is below 1e-3 of its value, so a click cut mid-envelope does not pop.
const STOP_TIME_CONSTANT = 0.002;
const STOP_DISCONNECT_MS = 15;
const MAX_ACCENT_HZ = 1760;
const ACCENT_HZ = 1320;
const NORMAL_HZ = 880;

// Pitch and peak gain of the click of each level that sounds.
const CLICKS: Record<Exclude<Level, "mute">, { hz: number; gain: number }> = {
  normal: { hz: NORMAL_HZ, gain: NORMAL_GAIN },
  accent: { hz: ACCENT_HZ, gain: ACCENT_GAIN },
  maxAccent: { hz: MAX_ACCENT_HZ, gain: MAX_ACCENT_GAIN },
};

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

function subDivisionOf(beats: readonly BeatSettings[], beat: number): number {
  return Math.max(1, beats[beat]?.subDivision ?? 1);
}

// Returns the position that follows `pos` under the current settings.
// A beat index outside the bar wraps to the first beat; a subdivision index at or past
// the beat's subdivision count moves to the next beat.
export function nextPosition(pos: Position, beatCount: number, beats: readonly BeatSettings[]): Position {
  if (pos.beat >= beatCount) return { beat: 0, sub: 0 };
  if (pos.sub + 1 < subDivisionOf(beats, pos.beat)) return { beat: pos.beat, sub: pos.sub + 1 };
  return { beat: (pos.beat + 1) % beatCount, sub: 0 };
}

// Lookahead scheduler: a timer schedules every note that falls within LOOKAHEAD seconds of
// the audio clock, and an animation frame loop reports the note currently sounding.
export class Metronome {
  #readSettings: () => Settings;
  #onActive: (pos: Position | null) => void;
  #ctx: AudioContext | null = null;
  #output: GainNode | null = null;
  #volume = 1;
  #timer: ReturnType<typeof setInterval> | undefined;
  #frame: number | undefined;
  #last: ScheduledNote | null = null;
  #startTime = 0;
  // Scheduled notes not yet reached by the audio clock, in time order.
  #queue: ScheduledNote[] = [];
  // Oscillators of the current run that may not have started yet, so stop() can cancel them.
  #pending: { osc: OscillatorNode; time: number }[] = [];

  constructor(readSettings: () => Settings, onActive: (pos: Position | null) => void) {
    this.#readSettings = readSettings;
    this.#onActive = onActive;
  }

  // Must be called from a user gesture the first time, so the AudioContext may start.
  start() {
    this.stop();
    setAudioSessionToPlayback();
    this.#ctx ??= new AudioContext();
    const ctx = this.#ctx;
    void ctx.resume();
    // A fresh output node per run, so stop() can silence notes already scheduled. Its gain is the master volume.
    this.#output = ctx.createGain();
    this.#output.gain.value = this.#volume;
    this.#output.connect(ctx.destination);
    this.#last = null;
    this.#startTime = ctx.currentTime + START_DELAY;
    this.#schedule();
    this.#timer = setInterval(() => this.#schedule(), TICK_MS);
    this.#frame = requestAnimationFrame(this.#draw);
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = undefined;
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
    const ctx = this.#ctx;
    const output = this.#output;
    if (ctx && output) {
      const now = ctx.currentTime;
      // Notes that have not started do not sound; the ones sounding fade out. Volume changes use
      // setTargetAtTime from the current time too, so this later event takes over from them.
      for (const { osc, time } of this.#pending) if (time > now) osc.stop(now);
      output.gain.setTargetAtTime(0, now, STOP_TIME_CONSTANT);
      setTimeout(() => output.disconnect(), STOP_DISCONNECT_MS);
    }
    this.#pending = [];
    this.#output = null;
    this.#queue = [];
    this.#last = null;
    this.#onActive(null);
  }

  // Master volume, 0 to 1; applies at once, also during playback.
  setVolume(volume: number) {
    this.#volume = volume;
    if (this.#ctx && this.#output) this.#output.gain.setTargetAtTime(volume, this.#ctx.currentTime, VOLUME_TIME_CONSTANT);
  }

  dispose() {
    this.stop();
    void this.#ctx?.close();
    this.#ctx = null;
  }

  #schedule() {
    const ctx = this.#ctx;
    const output = this.#output;
    if (!ctx || !output) return;
    const horizon = ctx.currentTime + LOOKAHEAD;
    this.#pending = this.#pending.filter((p) => p.time > ctx.currentTime);
    for (;;) {
      // Settings are read for every note, so changes apply from the next unscheduled note.
      const { tempo, beatCount, beats } = this.#readSettings();
      let note: ScheduledNote;
      if (this.#last === null) {
        note = { time: this.#startTime, beat: 0, sub: 0 };
      } else {
        const interval = 60 / tempo / subDivisionOf(beats, this.#last.beat);
        note = { time: this.#last.time + interval, ...nextPosition(this.#last, beatCount, beats) };
      }
      if (note.time >= horizon) return;
      // After a timer stall (e.g. a background tab), continue from now instead of playing a burst of late notes.
      if (note.time < ctx.currentTime) note.time = ctx.currentTime;
      const level = beats[note.beat]?.levels[note.sub] ?? "mute";
      if (level !== "mute") this.#click(ctx, output, note.time, CLICKS[level].hz, CLICKS[level].gain);
      // Muted subdivisions are queued too, so their position is still shown.
      this.#queue.push(note);
      this.#last = note;
    }
  }

  #click(ctx: AudioContext, output: AudioNode, time: number, hz: number, peak: number) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + ATTACK);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + ATTACK + DECAY);
    osc.connect(gain);
    gain.connect(output);
    osc.start(time);
    osc.stop(time + ATTACK + DECAY);
    this.#pending.push({ osc, time });
  }

  // Arrow function so it can be passed to requestAnimationFrame directly.
  #draw = () => {
    const ctx = this.#ctx;
    if (!ctx) return;
    // The latest note the audio clock has reached is the one sounding; older ones are dropped.
    let current: ScheduledNote | undefined;
    while (this.#queue.length > 0 && this.#queue[0].time <= ctx.currentTime) current = this.#queue.shift();
    if (current) this.#onActive({ beat: current.beat, sub: current.sub });
    this.#frame = requestAnimationFrame(this.#draw);
  };
}
