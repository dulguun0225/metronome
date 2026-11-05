// Note grid and click synthesis, without browser APIs: the AudioWorklet processor in clickWorklet.ts
// runs it on the audio thread, and unit tests run it directly.

// How a subdivision sounds: not at all, or with a click of rising pitch and gain.
export type Level = "mute" | "normal" | "accent" | "maxAccent";

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

// A note the generator has started: its onset in seconds of the audio clock (frame / sample rate,
// so the AudioContext's currentTime scale), its position, and the pitch and peak gain of its click
// (both 0 for a muted note).
export interface NoteReport extends Position {
  time: number;
  hz: number;
  peak: number;
}

// Name of the AudioWorklet processor, its constructor options and the messages it receives.
export const PROCESSOR_NAME = "metronome-clicks";
export interface ProcessorOptions {
  settings: Settings;
}
export type ProcessorMessage = { type: "settings"; settings: Settings } | { type: "stop" };

// Click sound: the envelope of an exponential ramp from MIN_GAIN to the peak over ATTACK seconds,
// then down to MIN_GAIN over DECAY seconds, as AudioParam.exponentialRampToValueAtTime makes it.
const ATTACK = 0.002;
const DECAY = 0.04;
const MIN_GAIN = 0.0001;
const MAX_ACCENT_GAIN = 1;
const ACCENT_GAIN = 0.7;
const NORMAL_GAIN = 0.5;
const MAX_ACCENT_HZ = 1760;
const ACCENT_HZ = 1320;
const NORMAL_HZ = 880;

// Pitch and peak gain of the click of each level that sounds.
export const CLICKS: Record<Exclude<Level, "mute">, { hz: number; gain: number }> = {
  normal: { hz: NORMAL_HZ, gain: NORMAL_GAIN },
  accent: { hz: ACCENT_HZ, gain: ACCENT_GAIN },
  maxAccent: { hz: MAX_ACCENT_HZ, gain: MAX_ACCENT_GAIN },
};

// Note intervals are counted in units of 1/TICKS_PER_BEAT beat. 840 is the least common multiple of
// 1 to 8, so every interval of a beat with up to 8 subdivisions is a whole number of ticks.
const TICKS_PER_BEAT = 840;

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

// Value of a click's signal `t` seconds after its onset; 0 before the onset and after the decay.
export function clickSample(t: number, hz: number, peak: number): number {
  if (t <= 0 || t >= ATTACK + DECAY) return 0;
  const gain = t < ATTACK ? MIN_GAIN * (peak / MIN_GAIN) ** (t / ATTACK) : peak * (MIN_GAIN / peak) ** ((t - ATTACK) / DECAY);
  return gain * Math.sin(2 * Math.PI * hz * t);
}

interface Note extends Position {
  // Onset in sample frames; may be fractional.
  onset: number;
}

interface Voice {
  onset: number;
  hz: number;
  peak: number;
}

// Generates the metronome's clicks block by block. Onsets are exact, fractional sample frames: each
// is the onset of the previous note plus its interval, where the interval is set by the current tempo
// and the subdivision of the previous note's beat. Settings apply from the next note that has not
// started. Onsets are computed as an anchor plus a whole number of ticks, the anchor being the first
// onset or the last onset before a tempo change, so rounding errors do not add up over a run.
export class ClickGenerator {
  readonly #sampleRate: number;
  #settings: Settings;
  #stopped = false;
  #last: Note | null = null;
  #anchor = 0;
  #anchorTempo = 0;
  // Ticks from the anchor to the last note.
  #ticks = 0;
  #voices: Voice[] = [];

  constructor(sampleRate: number, settings: Settings) {
    this.#sampleRate = sampleRate;
    this.#settings = settings;
  }

  setSettings(settings: Settings) {
    this.#settings = settings;
  }

  // Starts no further notes; clicks already sounding play to their end.
  stop() {
    this.#stopped = true;
  }

  // Whether stop() was called and no click is sounding.
  get done(): boolean {
    return this.#stopped && this.#voices.length === 0;
  }

  // Fills `out` with the signal from sample frame `frame` on, and returns the notes whose onsets fall
  // in that block. The first call's frame is the first onset. A note whose onset is before `frame`
  // (after a gap between blocks, or when a settings change moves the next onsets into the past) is
  // skipped: it is not played or returned, but its position is passed, and later notes stay on the grid.
  render(out: Float32Array, frame: number): NoteReport[] {
    out.fill(0);
    const end = frame + out.length;
    const notes: NoteReport[] = [];
    while (!this.#stopped) {
      const note = this.#advance(frame, end);
      if (!note) break;
      if (note.onset < frame) continue;
      const level = this.#settings.beats[note.beat]?.levels[note.sub] ?? "mute";
      const click = level === "mute" ? null : CLICKS[level];
      const hz = click?.hz ?? 0;
      const peak = click?.gain ?? 0;
      if (click) this.#voices.push({ onset: note.onset, hz, peak });
      notes.push({ time: note.onset / this.#sampleRate, beat: note.beat, sub: note.sub, hz, peak });
    }
    for (const voice of this.#voices) {
      for (let i = 0; i < out.length; i++) out[i] += clickSample((frame + i - voice.onset) / this.#sampleRate, voice.hz, voice.peak);
    }
    // Clicks that have ended by the next block are dropped.
    this.#voices = this.#voices.filter((v) => (end - v.onset) / this.#sampleRate < ATTACK + DECAY);
    return notes;
  }

  // Makes the next note the last one and returns it if its onset is before `end`; otherwise returns null
  // and leaves the state as it is, so later settings changes still apply to that note.
  #advance(frame: number, end: number): Note | null {
    const last = this.#last;
    const { tempo, beatCount, beats } = this.#settings;
    if (last === null) {
      this.#last = { onset: frame, beat: 0, sub: 0 };
      this.#anchor = frame;
      this.#anchorTempo = tempo;
      this.#ticks = 0;
      return this.#last;
    }
    const step = TICKS_PER_BEAT / subDivisionOf(beats, last.beat);
    const framesPerTick = (60 * this.#sampleRate) / (tempo * TICKS_PER_BEAT);
    const sameTempo = tempo === this.#anchorTempo;
    const onset = sameTempo ? this.#anchor + (this.#ticks + step) * framesPerTick : last.onset + step * framesPerTick;
    // Also false for a NaN onset, so invalid settings stop the notes instead of looping.
    if (!(onset < end)) return null;
    if (sameTempo) {
      this.#ticks += step;
    } else {
      this.#anchor = last.onset;
      this.#anchorTempo = tempo;
      this.#ticks = step;
    }
    this.#last = { onset, ...nextPosition(last, beatCount, beats) };
    return this.#last;
  }
}
