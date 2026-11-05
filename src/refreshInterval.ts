// The refresh interval is estimated from the differences between the latest this many + 1 frame times.
export const REFRESH_INTERVAL_FRAMES = 16;
// Differences longer than this, in ms, are not used: they span a hidden page, a stop and start, or a
// stall, not a refresh. 50 ms is a 20 Hz refresh rate, below that of any display.
export const MAX_REFRESH_INTERVAL_MS = 50;
// Fewer usable differences than this give no estimate.
export const MIN_REFRESH_INTERVAL_DIFFERENCES = 4;

// The display refresh interval in ms, estimated from the times requestAnimationFrame passed to
// consecutive animation frames (`frameTimes`, oldest first), or 0 when there are too few usable differences.
// The estimate is the lower quartile of the differences up to MAX_REFRESH_INTERVAL_MS. A skipped frame
// makes a difference a multiple of the interval, and a frame run off the refresh schedule makes one
// shorter (Firefox ran the first two frames of a loop 0.2 ms apart). The lower quartile is a one-refresh
// difference while at most a quarter of the differences are short and fewer than three quarters are long. When
// the differences vary (variable refresh rate, timer jitter), it is one of the shorter ones, so a note is
// shown early by less, not more, than half a refresh interval.
export function refreshInterval(frameTimes: readonly number[]): number {
  const differences: number[] = [];
  for (let i = 1; i < frameTimes.length; i++) {
    const difference = frameTimes[i] - frameTimes[i - 1];
    if (difference >= 0 && difference <= MAX_REFRESH_INTERVAL_MS) differences.push(difference);
  }
  if (differences.length < MIN_REFRESH_INTERVAL_DIFFERENCES) return 0;
  differences.sort((a, b) => a - b);
  return differences[Math.floor(differences.length / 4)];
}
