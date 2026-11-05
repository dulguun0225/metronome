import type { Page } from "@playwright/test";
import { PROCESSOR_NAME, type Level, type Settings } from "../../src/clickGenerator";
import { clickStarts, maxDifference, REFERENCE_CLICKS, referenceSignal } from "../clickReference";
import { expect, start, stop, test } from "./fixtures";

const SAMPLE_RATE = 44100;
const SECONDS = 6;
// 300 BPM with 8 subdivisions: a note every 25 ms, 1102.5 frames, so every other onset falls between samples.
const NOTE_FRAMES = (60 * SAMPLE_RATE) / 300 / 8;

// The app's worklet module, as the page loaded it.
async function workletUrl(page: Page) {
  await page.goto("/");
  await start(page);
  await page.waitForFunction(() => window.__audio.modules.length > 0 && window.__audio.clicks.length > 0);
  await stop(page);
  return page.evaluate(() => window.__audio.modules[0]);
}

// Renders the worklet in an OfflineAudioContext from frame 0 with fixed settings.
function renderOffline(page: Page, url: string, settings: Settings): Promise<number[]> {
  return page.evaluate(
    async ({ url, settings, name, sampleRate, seconds }) => {
      const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: sampleRate * seconds, sampleRate });
      await ctx.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(ctx, name, { numberOfInputs: 0, outputChannelCount: [1], processorOptions: { settings } });
      node.connect(ctx.destination);
      const buffer = await ctx.startRendering();
      return Array.from(buffer.getChannelData(0));
    },
    { url, settings, name: PROCESSOR_NAME, sampleRate: SAMPLE_RATE, seconds: SECONDS },
  );
}

// 4 beats of 8 subdivisions with the same levels.
function settingsOf(levels: Level[]): Settings {
  return { tempo: 300, beatCount: 4, beats: Array.from({ length: 4 }, () => ({ subDivision: 8, levels })) };
}

// Onset and level of every note of a run, on the exact grid.
function grid(levels: Level[]) {
  return Array.from({ length: Math.ceil((SAMPLE_RATE * SECONDS) / NOTE_FRAMES) }, (_, k) => ({ onset: k * NOTE_FRAMES, level: levels[k % 8] }));
}

test("the app's worklet renders 300 BPM with 8 subdivisions with every click within 1 sample of the grid", async ({ page }) => {
  const url = await workletUrl(page);

  // Every other note muted, so the clicks (42 ms) do not overlap; the second run sounds the other half.
  for (const pattern of [
    ["maxAccent", "mute", "normal", "mute", "accent", "mute", "normal", "mute"],
    ["mute", "normal", "mute", "accent", "mute", "maxAccent", "mute", "normal"],
  ] as Level[][]) {
    const x = await renderOffline(page, url, settingsOf(pattern));
    const onsets = grid(pattern)
      .filter((n) => n.level !== "mute")
      .map((n) => n.onset);
    const starts = clickStarts(x, 100);
    expect(starts.length).toBe(onsets.length);
    expect(onsets.length).toBe(120);
    const offsets = starts.map((s, i) => s - onsets[i]);
    // The first non-zero sample is within 1 sample after the exact onset.
    expect(Math.min(...offsets)).toBeGreaterThan(0);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(1);
  }
});

test("the app's worklet output matches the reference: pitch and peak per level, overlapping clicks summed", async ({ page }) => {
  const url = await workletUrl(page);
  const levels: Level[] = ["maxAccent", "normal", "accent", "normal", "mute", "normal", "accent", "normal"];
  const x = await renderOffline(page, url, settingsOf(levels));
  const notes = grid(levels).map((n) => (n.level === "mute" ? { onset: n.onset, hz: 0, peak: 0 } : { onset: n.onset, ...REFERENCE_CLICKS[n.level] }));
  // Float32 output; a click's last sample, below 1e-4, may fall on either side of the end of the click.
  expect(maxDifference(x, referenceSignal(notes, x.length, SAMPLE_RATE))).toBeLessThan(1e-4);
});
