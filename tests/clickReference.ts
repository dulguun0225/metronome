// Reference for checking rendered clicks, written from the Web Audio API definitions the click sound
// follows rather than from the app's code: an oscillator started at the onset and stopped 42 ms later,
// through a gain set to 0.0001 at the onset, ramped exponentially to the peak at 2 ms and back to
// 0.0001 at 42 ms (AudioParam.exponentialRampToValueAtTime: v(t) = v0 * (v1 / v0) ^ ((t - t0) / (t1 - t0))).

import type { Level } from "../src/clickGenerator";

export const REFERENCE_CLICKS: Record<Exclude<Level, "mute">, { hz: number; peak: number }> = {
  normal: { hz: 880, peak: 0.5 },
  accent: { hz: 1320, peak: 0.7 },
  maxAccent: { hz: 1760, peak: 1 },
};

const START_GAIN = 0.0001;
const PEAK_AT = 0.002;
const END_AT = 0.042;

function ramp(v0: number, v1: number, t0: number, t1: number, t: number) {
  return v0 * (v1 / v0) ** ((t - t0) / (t1 - t0));
}

// The click's value `t` seconds after its onset.
export function referenceClick(t: number, hz: number, peak: number): number {
  if (t <= 0 || t >= END_AT) return 0;
  const gain = t < PEAK_AT ? ramp(START_GAIN, peak, 0, PEAK_AT, t) : ramp(peak, START_GAIN, PEAK_AT, END_AT, t);
  return gain * Math.sin(2 * Math.PI * hz * t);
}

export interface ReferenceNote {
  // Onset in sample frames from the start of the signal.
  onset: number;
  hz: number;
  peak: number;
}

// The sum of the clicks of `notes` (those with peak 0 are silent), `length` samples long.
export function referenceSignal(notes: ReferenceNote[], length: number, sampleRate: number): Float64Array {
  const out = new Float64Array(length);
  for (const n of notes) {
    // A muted note has no click.
    if (n.peak === 0) continue;
    const last = Math.min(length - 1, Math.floor(n.onset + END_AT * sampleRate));
    for (let i = Math.max(0, Math.ceil(n.onset)); i <= last; i++) out[i] += referenceClick((i - n.onset) / sampleRate, n.hz, n.peak);
  }
  return out;
}

// Largest absolute difference between two signals of the same length.
export function maxDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error(`lengths differ: ${a.length} and ${b.length}`);
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

// Index of the first non-zero sample of each click: a non-zero sample after at least `gap` zero samples
// (or at the start of the signal).
export function clickStarts(x: ArrayLike<number>, gap: number): number[] {
  const starts: number[] = [];
  let zeros = gap;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === 0) {
      zeros++;
    } else {
      if (zeros >= gap) starts.push(i);
      zeros = 0;
    }
  }
  return starts;
}
