import { describe, expect, test } from "vitest";
import { TAP_TIMEOUT_MS, tapTempo } from "../../src/tapTempo";

// Feeds tap times in order and returns the tempo after each tap.
function tempos(times: number[]) {
  let taps: number[] = [];
  return times.map((t) => {
    const r = tapTempo(taps, t);
    taps = r.taps;
    return r.tempo;
  });
}

describe("tapTempo", () => {
  test("a first tap gives no tempo", () => {
    expect(tapTempo([], 1000)).toEqual({ taps: [1000], tempo: null });
  });

  test("two taps 500 ms apart give 120 BPM", () => {
    expect(tempos([0, 500])).toEqual([null, 120]);
  });

  test("uses the mean of the last up to 4 intervals", () => {
    // Intervals 1000, 300, 300, 300, 600. After four intervals the mean is 475 ms (126.3 BPM);
    // after five, the first interval is dropped and the mean of the last four is 375 ms.
    const result = tempos([0, 1000, 1300, 1600, 1900, 2500]);
    expect(result[4]).toBe(126);
    expect(result[5]).toBe(160);
  });

  test("keeps only the taps needed for 4 intervals", () => {
    let taps: number[] = [];
    for (const t of [0, 400, 800, 1200, 1600, 2000, 2400]) taps = tapTempo(taps, t).taps;
    expect(taps).toEqual([800, 1200, 1600, 2000, 2400]);
  });

  test("a tap more than 2 s after the previous one starts a new sequence", () => {
    expect(tempos([0, 500, 500 + TAP_TIMEOUT_MS + 1, 500 + TAP_TIMEOUT_MS + 1 + 250])).toEqual([null, 120, null, 240]);
  });

  test("a tap exactly 2 s after the previous one continues the sequence", () => {
    expect(tempos([0, TAP_TIMEOUT_MS])).toEqual([null, 30]);
  });

  test("rounds to whole BPM", () => {
    // 60000 / 700 = 85.71
    expect(tempos([0, 700])).toEqual([null, 86]);
  });

  test("clamps fast taps to 300 BPM", () => {
    expect(tempos([0, 100, 200])).toEqual([null, 300, 300]);
  });

  test("taps at the same time clamp to 300 BPM", () => {
    expect(tempos([5, 5])).toEqual([null, 300]);
  });

  test("a tap earlier than the previous one starts a new sequence", () => {
    expect(tapTempo([1000, 1500], 900)).toEqual({ taps: [900], tempo: null });
  });
});
