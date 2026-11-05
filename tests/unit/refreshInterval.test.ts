import { describe, expect, test } from "vitest";
import { MAX_REFRESH_INTERVAL_MS, MIN_REFRESH_INTERVAL_DIFFERENCES, refreshInterval } from "../../src/refreshInterval";

// Frame times from `start`, one per difference given, in ms.
function times(differences: number[], start = 1000) {
  const out = [start];
  for (const d of differences) out.push(out[out.length - 1] + d);
  return out;
}

const HZ_60 = 1000 / 60;
const HZ_120 = 1000 / 120;

describe("refreshInterval", () => {
  test("gives 0 with fewer than the minimum number of differences", () => {
    expect(refreshInterval([])).toBe(0);
    expect(refreshInterval([1000])).toBe(0);
    expect(refreshInterval(times(Array(MIN_REFRESH_INTERVAL_DIFFERENCES - 1).fill(HZ_60)))).toBe(0);
    expect(refreshInterval(times(Array(MIN_REFRESH_INTERVAL_DIFFERENCES).fill(HZ_60)))).toBeCloseTo(HZ_60, 9);
  });

  test("gives the interval at 60 Hz, 120 Hz and 144 Hz", () => {
    expect(refreshInterval(times(Array(16).fill(HZ_60)))).toBeCloseTo(HZ_60, 9);
    expect(refreshInterval(times(Array(16).fill(HZ_120)))).toBeCloseTo(HZ_120, 9);
    expect(refreshInterval(times(Array(16).fill(1000 / 144)))).toBeCloseTo(1000 / 144, 9);
  });

  test("skipped frames do not lengthen it while fewer than three quarters of the differences are long", () => {
    const d = HZ_60;
    expect(refreshInterval(times([d, 2 * d, d, 3 * d, 2 * d, d, 2 * d, d, d, 2 * d, 2 * d, 2 * d, 2 * d, 2 * d, 2 * d, 2 * d]))).toBeCloseTo(d, 9);
  });

  test("ignores up to a quarter of the differences being short", () => {
    // Firefox ran the first two frames of a loop 0.2 ms apart.
    expect(refreshInterval(times([0.2, 0.2, 1, 0, ...Array(12).fill(HZ_60)]))).toBeCloseTo(HZ_60, 9);
  });

  test("ignores differences longer than the maximum, as after a hidden page or a stop and start", () => {
    expect(refreshInterval(times([5000, ...Array(8).fill(HZ_60), 1200, ...Array(6).fill(HZ_60)]))).toBeCloseTo(HZ_60, 9);
    expect(refreshInterval(times([MAX_REFRESH_INTERVAL_MS + 0.01, 1000, 200, 60, HZ_60, HZ_60, HZ_60]))).toBe(0);
  });

  test("gives one of the shorter differences when they vary", () => {
    // Firefox headless alternates differences of about 16.1 and 17.1 ms.
    expect(refreshInterval(times([16.1, 17.1, 16.1, 17.1, 16.2, 17.1, 16.1, 17.1]))).toBeCloseTo(16.1, 9);
  });
});
