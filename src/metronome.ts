export interface BeatSettings {
  subDivision: number;
  // One flag per possible subdivision; only the first `subDivision` flags are used.
  enabled: boolean[];
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

// Click sound.
const ATTACK = 0.002;
const DECAY = 0.04;
const PEAK_GAIN = 0.8;
const ACCENT_HZ = 1760;
const BEAT_HZ = 1320;
const SUB_HZ = 880;

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
  #timer: ReturnType<typeof setInterval> | undefined;
  #frame: number | undefined;
  #last: ScheduledNote | null = null;
  #startTime = 0;
  // Scheduled notes not yet reached by the audio clock, in time order.
  #queue: ScheduledNote[] = [];

  constructor(readSettings: () => Settings, onActive: (pos: Position | null) => void) {
    this.#readSettings = readSettings;
    this.#onActive = onActive;
  }

  // Must be called from a user gesture the first time, so the AudioContext may start.
  start() {
    this.stop();
    this.#ctx ??= new AudioContext();
    const ctx = this.#ctx;
    void ctx.resume();
    // A fresh output node per run, so stop() can silence notes already scheduled.
    this.#output = ctx.createGain();
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
    this.#output?.disconnect();
    this.#output = null;
    this.#queue = [];
    this.#last = null;
    this.#onActive(null);
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
      if (beats[note.beat]?.enabled[note.sub]) {
        const hz = note.sub > 0 ? SUB_HZ : note.beat === 0 ? ACCENT_HZ : BEAT_HZ;
        this.#click(ctx, output, note.time, hz);
      }
      // Unchecked subdivisions are queued too, so their position is still shown.
      this.#queue.push(note);
      this.#last = note;
    }
  }

  #click(ctx: AudioContext, output: AudioNode, time: number, hz: number) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, time + ATTACK);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + ATTACK + DECAY);
    osc.connect(gain);
    gain.connect(output);
    osc.start(time);
    osc.stop(time + ATTACK + DECAY);
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
