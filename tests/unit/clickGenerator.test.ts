import { describe, expect, test } from "vitest";
import { ClickGenerator, nextPosition, type BeatSettings, type Level, type NoteReport, type Settings } from "../../src/clickGenerator";
import { clickStarts, maxDifference, REFERENCE_CLICKS, referenceSignal, type ReferenceNote } from "../clickReference";

const BLOCK = 128;
// Largest difference from the reference signal: Float32 rounding, and a click's last sample, which is
// below 1e-4 and may fall on either side of the end of the click.
const SIGNAL_TOLERANCE = 1e-4;

function beat(subDivision: number, levels: Level[] = Array<Level>(8).fill("normal")): BeatSettings {
  return { subDivision, levels };
}

// Levels of a beat: `first` for the first subdivision, `rest` for the others.
function levels(first: Level, rest: Level = "normal"): Level[] {
  return [first, ...Array<Level>(7).fill(rest)];
}

function settings(tempo: number, beats: BeatSettings[], beatCount = beats.length): Settings {
  return { tempo, beatCount, beats };
}

interface Rendered {
  out: Float32Array;
  notes: NoteReport[];
}

// Renders `length` frames from frame `from` in blocks, calling `before(frame)` before each block.
function render(gen: ClickGenerator, length: number, from = 0, before?: (frame: number) => void): Rendered {
  const out = new Float32Array(length);
  const notes: NoteReport[] = [];
  for (let i = 0; i < length; i += BLOCK) {
    before?.(from + i);
    notes.push(...gen.render(out.subarray(i, i + BLOCK), from + i));
  }
  return { out, notes };
}

// A reported note's onset in frames, rounded to 1e-6 frame.
function onsetFrame(n: NoteReport, sampleRate: number) {
  return Math.round(n.time * sampleRate * 1e6) / 1e6;
}

function referenceNote(onset: number, level: Level): ReferenceNote {
  return level === "mute" ? { onset, hz: 0, peak: 0 } : { onset, ...REFERENCE_CLICKS[level] };
}

// The expected notes of a run under fixed settings, from frame 0: onsets from the closed form
// (bar, beat and subdivision index times their durations), not by adding up intervals.
function expectedRun(s: Settings, sampleRate: number, length: number) {
  const beatFrames = (60 * sampleRate) / s.tempo;
  const notes: (ReferenceNote & { beat: number; sub: number; level: Level })[] = [];
  for (let bar = 0; ; bar++) {
    for (let b = 0; b < s.beatCount; b++) {
      const { subDivision, levels: beatLevels } = s.beats[b];
      for (let sub = 0; sub < subDivision; sub++) {
        const onset = (bar * s.beatCount + b) * beatFrames + (sub * beatFrames) / subDivision;
        if (onset >= length) return notes;
        notes.push({ ...referenceNote(onset, beatLevels[sub]), beat: b, sub, level: beatLevels[sub] });
      }
    }
  }
}

function expectNotes(actual: NoteReport[], expected: ReturnType<typeof expectedRun>, sampleRate: number) {
  expect(actual.length).toBe(expected.length);
  let worst = 0;
  actual.forEach((n, i) => {
    const e = expected[i];
    worst = Math.max(worst, Math.abs(n.time * sampleRate - e.onset));
    if (n.beat !== e.beat || n.sub !== e.sub || n.hz !== e.hz || n.peak !== e.peak) {
      expect({ i, beat: n.beat, sub: n.sub, hz: n.hz, peak: n.peak }).toEqual({ i, beat: e.beat, sub: e.sub, hz: e.hz, peak: e.peak });
    }
  });
  expect(worst, "largest onset error in frames").toBeLessThan(1e-6);
}

// Every click's first non-zero sample is within 1 sample after its exact onset (the sample at the onset
// itself is 0, as the sine starts at phase 0).
function expectStartsOnGrid(out: Float32Array, onsets: number[]) {
  const starts = clickStarts(out, 100);
  expect(starts.length).toBe(onsets.length);
  starts.forEach((s, i) => {
    const offset = s - onsets[i];
    if (!(offset > 0 && offset <= 1)) expect({ click: i, start: s, onset: onsets[i] }).toBe("first sample within 1 sample after the onset");
  });
}

describe("ClickGenerator", () => {
  test("300 BPM with 8 subdivisions over three minutes: every click on the exact grid, overlapping clicks summed", () => {
    const sampleRate = 44100;
    // One click every 25 ms (1102.5 frames, so half of the onsets fall between samples); clicks last 42 ms.
    const s = settings(300, [beat(8, levels("maxAccent")), beat(8, ["accent", "normal", "mute", "normal", "maxAccent", "normal", "accent", "normal"]), beat(8, levels("accent")), beat(8, levels("accent"))]);
    const length = 180 * sampleRate;
    const { out, notes } = render(new ClickGenerator(sampleRate, s), length);
    const expected = expectedRun(s, sampleRate, length);
    expect(expected.length).toBe(7200);
    expectNotes(notes, expected, sampleRate);
    expect(maxDifference(out, referenceSignal(expected, length, sampleRate))).toBeLessThan(SIGNAL_TOLERANCE);
  });

  test("first sample of every click within 1 sample of the grid over two minutes at 300 BPM with 8 subdivisions", () => {
    // Every other note is muted so the clicks do not overlap; the second run sounds the other half.
    for (const sampleRate of [44100, 48000]) {
      for (const first of ["normal", "mute"] as const) {
        const other: Level = first === "mute" ? "accent" : "mute";
        const pattern: Level[] = [first, other, first, other, first, other, first, other];
        const s = settings(300, [beat(8, pattern), beat(8, pattern), beat(8, pattern)]);
        const length = 120 * sampleRate;
        const { out } = render(new ClickGenerator(sampleRate, s), length);
        const onsets = expectedRun(s, sampleRate, length).filter((n) => n.level !== "mute").map((n) => n.onset);
        expect(onsets.length).toBe(2400);
        expectStartsOnGrid(out, onsets);
      }
    }
  });

  test("mixed subdivisions per beat stay on the grid over two minutes", () => {
    const sampleRate = 48000;
    const s = settings(
      137,
      [3, 5, 7, 8, 1, 2, 6, 4].map((n, i) => beat(n, levels(i === 0 ? "maxAccent" : "accent"))),
    );
    const length = 120 * sampleRate;
    const { out, notes } = render(new ClickGenerator(sampleRate, s), length);
    const expected = expectedRun(s, sampleRate, length);
    expectNotes(notes, expected, sampleRate);
    expect(maxDifference(out, referenceSignal(expected, length, sampleRate))).toBeLessThan(SIGNAL_TOLERANCE);
  });

  test("onsets do not add up rounding errors late in a long-lived context: from frame 2^33 (54 hours at 44.1 kHz) for three minutes", () => {
    // The context's frame count keeps growing across runs. At 137 BPM with 7 subdivisions a note interval is not
    // a whole number of frames; adding it note by note is off by 2e-3 frames after three minutes here.
    const sampleRate = 44100;
    const from = 2 ** 33;
    const s = settings(137, [beat(7), beat(7), beat(7), beat(7)]);
    const { notes } = render(new ClickGenerator(sampleRate, s), 180 * sampleRate, from);
    const interval = (60 * sampleRate) / 137 / 7;
    expect(notes.length).toBe(Math.ceil((180 * sampleRate) / interval));
    const worst = Math.max(...notes.map((n, k) => Math.abs(n.time * sampleRate - (from + k * interval))));
    expect(worst, "largest onset error in frames").toBeLessThan(1e-4);
  });

  test("the first onset is the first rendered frame", () => {
    const gen = new ClickGenerator(48000, settings(120, [beat(4)]));
    const { notes } = render(gen, 48000, 1_000_000);
    expect(notes.map((n) => onsetFrame(n, 48000))).toEqual([1_000_000, 1_006_000, 1_012_000, 1_018_000, 1_024_000, 1_030_000, 1_036_000, 1_042_000]);
  });

  test("tempo, subdivision, level and beat count changes apply from the next note", () => {
    const sampleRate = 48000;
    const beats = [beat(4, levels("maxAccent")), beat(4, levels("accent")), beat(4, levels("accent")), beat(4, levels("accent"))];
    const gen = new ClickGenerator(sampleRate, settings(120, beats));
    // Notes every 6000 frames; the note at 30000, beat 2 subdivision 2, is the last one before the change.
    let changed = false;
    const { out, notes } = render(gen, 4 * sampleRate, 0, (frame) => {
      if (frame > 30000 && !changed) {
        changed = true;
        // Beat 2 to 3 subdivisions, the 3rd note of beat 3 to max accent, tempo 90, and the count to 3.
        const next = beats.map((b) => ({ ...b, levels: [...b.levels] }));
        next[1].subDivision = 3;
        next[2].levels[2] = "maxAccent";
        gen.setSettings(settings(90, next, 3));
      }
    });
    const third = (60 * sampleRate) / 90 / 3;
    const quarter = (60 * sampleRate) / 90 / 4;
    const t0 = 30000 + third;
    const expected = [
      { beat: 0, sub: 0, onset: 0, level: "maxAccent" },
      { beat: 0, sub: 1, onset: 6000, level: "normal" },
      { beat: 0, sub: 2, onset: 12000, level: "normal" },
      { beat: 0, sub: 3, onset: 18000, level: "normal" },
      { beat: 1, sub: 0, onset: 24000, level: "accent" },
      { beat: 1, sub: 1, onset: 30000, level: "normal" },
      // Beat 2 now has 3 subdivisions at 90 BPM, from the last note.
      { beat: 1, sub: 2, onset: t0, level: "normal" },
      { beat: 2, sub: 0, onset: t0 + third, level: "accent" },
      { beat: 2, sub: 1, onset: t0 + third + quarter, level: "normal" },
      { beat: 2, sub: 2, onset: t0 + third + 2 * quarter, level: "maxAccent" },
      { beat: 2, sub: 3, onset: t0 + third + 3 * quarter, level: "normal" },
      // Three beats: back to the first.
      { beat: 0, sub: 0, onset: t0 + third + 4 * quarter, level: "maxAccent" },
      { beat: 0, sub: 1, onset: t0 + third + 5 * quarter, level: "normal" },
    ] as const;
    expected.forEach((e, i) => {
      expect({ beat: notes[i].beat, sub: notes[i].sub, hz: notes[i].hz, peak: notes[i].peak }, `note ${i}`).toEqual({
        beat: e.beat,
        sub: e.sub,
        ...REFERENCE_CLICKS[e.level],
      });
      expect(notes[i].time * sampleRate, `note ${i} onset`).toBeCloseTo(e.onset, 6);
    });
    const length = Math.ceil(expected[expected.length - 1].onset);
    expect(maxDifference(out.subarray(0, length), referenceSignal(expected.map((e) => referenceNote(e.onset, e.level)), length, sampleRate))).toBeLessThan(SIGNAL_TOLERANCE);
  });

  test("a change to the note that has started does not change its click", () => {
    const sampleRate = 48000;
    const gen = new ClickGenerator(sampleRate, settings(60, [beat(1, levels("accent"))]));
    const { out } = render(gen, 0.05 * sampleRate, 0, (frame) => {
      if (frame === BLOCK) gen.setSettings(settings(60, [beat(1, levels("mute"))]));
    });
    const length = out.length;
    expect(maxDifference(out, referenceSignal([referenceNote(0, "accent")], length, sampleRate))).toBeLessThan(SIGNAL_TOLERANCE);
  });

  test("notes whose onsets have passed after a tempo change are skipped and the next notes stay on the grid", () => {
    const sampleRate = 48000;
    const beats = [beat(1, levels("maxAccent")), beat(1, levels("accent")), beat(1, levels("accent")), beat(1, levels("accent"))];
    const gen = new ClickGenerator(sampleRate, settings(20, beats));
    // 20 BPM: the second note would be at 144000. At frame 100096 the tempo goes to 300 BPM (9600 frames per
    // note from the first note): the grid points 9600 to 96000 have passed, 105600 is the first at or after it.
    const changeAt = 100096;
    const { out, notes } = render(gen, 3 * sampleRate, 0, (frame) => {
      if (frame === changeAt) gen.setSettings(settings(300, beats));
    });
    expect(notes.slice(0, 4).map((n) => [onsetFrame(n, sampleRate), n.beat, n.sub])).toEqual([
      [0, 0, 0],
      // 11 notes on: positions 1 to 10 were passed without sound.
      [105600, 3, 0],
      [115200, 0, 0],
      [124800, 1, 0],
    ]);
    const silentFrom = Math.ceil(0.042 * sampleRate);
    expect(out.subarray(silentFrom, 105601).every((v) => v === 0)).toBe(true);
    const expected = notes.map((n) => ({ onset: n.time * sampleRate, hz: n.hz, peak: n.peak }));
    expect(maxDifference(out, referenceSignal(expected, out.length, sampleRate))).toBeLessThan(SIGNAL_TOLERANCE);
  });

  test("after a gap between blocks, passed notes are skipped and positions advance through them", () => {
    const sampleRate = 48000;
    const beats = [beat(4), beat(4), beat(4)];
    const gen = new ClickGenerator(sampleRate, settings(120, beats));
    render(gen, 6016);
    // Notes every 6000 frames; the next block starts at 100000, so notes 2 to 16 are passed and note 17 is the first played.
    const { notes } = render(gen, 12_800, 100_000);
    let pos = { beat: 0, sub: 1 };
    for (let i = 2; i <= 17; i++) pos = nextPosition(pos, 3, beats);
    expect(notes.map((n) => [onsetFrame(n, sampleRate), n.beat, n.sub])).toEqual([
      [102000, pos.beat, pos.sub],
      [108000, ...Object.values(nextPosition(pos, 3, beats))],
    ]);
  });

  test("a muted note is silent but reported", () => {
    const sampleRate = 44100;
    const s = settings(240, [beat(4, Array<Level>(8).fill("mute")), beat(2, ["normal", "mute", ...Array<Level>(6).fill("mute")])]);
    const length = 2 * sampleRate;
    const { out, notes } = render(new ClickGenerator(sampleRate, s), length);
    const expected = expectedRun(s, sampleRate, length);
    expectNotes(notes, expected, sampleRate);
    expect(notes.filter((n) => n.peak === 0)).toHaveLength(expected.filter((n) => n.level === "mute").length);
    expect(notes.filter((n) => n.peak === 0).every((n) => n.hz === 0)).toBe(true);
    expect(maxDifference(out, referenceSignal(expected, length, sampleRate))).toBeLessThan(SIGNAL_TOLERANCE);
    // Only the normal notes sound.
    expect(clickStarts(out, 100)).toHaveLength(expected.filter((n) => n.level === "normal").length);
  });

  test.each(["normal", "accent", "maxAccent"] as const)("a %s click has its pitch and peak", (level) => {
    const sampleRate = 48000;
    const { hz, peak } = REFERENCE_CLICKS[level];
    const { out, notes } = render(new ClickGenerator(sampleRate, settings(60, [beat(1, levels(level))])), 0.1 * sampleRate);
    expect(notes).toEqual([{ time: 0, beat: 0, sub: 0, hz, peak }]);
    // The envelope peaks at the level's gain; the largest sample is within a quarter period of the peak.
    const max = Math.max(...out.map(Math.abs));
    expect(max).toBeLessThanOrEqual(peak);
    expect(max).toBeGreaterThan(0.93 * peak);
    // The zero crossings, interpolated between samples, are half a period apart.
    const crossings: number[] = [];
    for (let i = 2; i < out.length; i++) {
      if ((out[i - 1] < 0 && out[i] > 0) || (out[i - 1] > 0 && out[i] < 0)) crossings.push(i - 1 + out[i - 1] / (out[i - 1] - out[i]));
    }
    const halfPeriod = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
    expect(sampleRate / (2 * halfPeriod)).toBeCloseTo(hz, 0);
    expect(maxDifference(out, referenceSignal([{ onset: 0, hz, peak }], out.length, sampleRate))).toBeLessThan(SIGNAL_TOLERANCE);
    // Silent after 42 ms.
    expect(out.subarray(Math.ceil(0.042 * sampleRate)).every((v) => v === 0)).toBe(true);
  });

  test("stop starts no further notes and lets the sounding click end", () => {
    const sampleRate = 48000;
    const gen = new ClickGenerator(sampleRate, settings(300, [beat(8)]));
    // Notes every 1200 frames; stop after the note at 1200 has started.
    const { out, notes } = render(gen, 0.2 * sampleRate, 0, (frame) => {
      if (frame === 1280) gen.stop();
      if (frame < Math.ceil(1200 + 0.042 * sampleRate)) expect(gen.done).toBe(false);
    });
    expect(notes.map((n) => onsetFrame(n, sampleRate))).toEqual([0, 1200]);
    expect(gen.done).toBe(true);
    expect(maxDifference(out, referenceSignal([{ onset: 0, hz: 880, peak: 0.5 }, { onset: 1200, hz: 880, peak: 0.5 }], out.length, sampleRate))).toBeLessThan(SIGNAL_TOLERANCE);
  });
});
