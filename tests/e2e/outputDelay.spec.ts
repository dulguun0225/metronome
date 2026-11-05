import type { Page } from "@playwright/test";
import { appState, clearClicks, expect, playButton, slide, start, stop, test, waitForClicks } from "./fixtures";

declare global {
  interface Window {
    __frames: { hold(): void; release(): void };
    __noteRefs: { alive(): number; count(): number };
  }
}

const KEY = "metronome:/:settings";
// Note interval at the default 120 BPM with 4 subdivisions.
const NOTE = 60 / 120 / 4;

interface ReportedLatency {
  // getOutputTimestamp() reports the frame at currentTime - timestampDelay as at the output device now;
  // null reports zeros, as before the first render.
  timestampDelay: number | null;
  // getOutputTimestamp() as Firefox reports it: contextTime and performanceTime both moved back by outputLatency.
  firefoxTimestamp?: boolean;
  // getOutputTimestamp() as WebKit reports it (WPE WebKit 27.2): contextTime 3 ms before currentTime, and
  // performanceTime later than performance.now() by the context time.
  webkitTimestamp?: boolean;
  baseLatency?: number;
  outputLatency?: number;
}

// Init script: replaces the latency the browser reports. Runs in the page, so it must not use outer variables.
function stubLatency(r: ReportedLatency) {
  const proto = AudioContext.prototype;
  proto.getOutputTimestamp = function (this: AudioContext) {
    if (r.webkitTimestamp) {
      if (this.currentTime <= 0.003) return { contextTime: 0, performanceTime: 0 };
      return { contextTime: this.currentTime - 0.003, performanceTime: performance.now() + this.currentTime * 1000 };
    }
    const delay = r.firefoxTimestamp ? (r.outputLatency ?? 0) : r.timestampDelay;
    if (delay === null || this.currentTime - delay <= 0) return { contextTime: 0, performanceTime: 0 };
    const performanceTime = performance.now() - (r.firefoxTimestamp ? delay * 1000 : 0);
    return { contextTime: this.currentTime - delay, performanceTime };
  };
  Object.defineProperty(proto, "baseLatency", { configurable: true, get: () => r.baseLatency });
  Object.defineProperty(proto, "outputLatency", { configurable: true, get: () => r.outputLatency });
}

// Samples the highlighted note on 60 animation frames once the audio clock is past 1 s, and returns how
// far each highlighted note's onset is behind currentTime - `delay`, in seconds.
async function highlightLags(page: Page, delay: number): Promise<number[]> {
  await page.waitForFunction(() => window.__audio.currentTime() > 1);
  return page.evaluate(async (delay) => {
    const lags: number[] = [];
    for (let i = 0; i < 60; i++) {
      await new Promise(requestAnimationFrame);
      const now = window.__audio.currentTime();
      const beats = [...document.querySelectorAll(".beat")];
      const beat = beats.findIndex((b) => b.classList.contains("active"));
      const sub = beat < 0 ? -1 : [...beats[beat].querySelectorAll(".sub")].findIndex((s) => s.classList.contains("active"));
      // The latest reported note at that position.
      const note = window.__audio.notes.filter((n) => n.beat === beat && n.sub === sub && n.time <= now).pop();
      lags.push(note ? now - delay - note.time : NaN);
    }
    return lags;
  }, delay);
}

// The highlighted note is the latest one whose onset the heard time has reached: its onset is at most a
// note interval behind it, with one animation frame of tolerance either side.
function expectHighlightFollows(lags: number[]) {
  expect(lags.every((l) => !Number.isNaN(l)), "a note is highlighted").toBe(true);
  expect(Math.min(...lags), "not shown before it is heard").toBeGreaterThan(-0.02);
  expect(Math.max(...lags), "the latest note heard").toBeLessThan(NOTE + 0.02);
}

const delayRadio = (page: Page, mode: "automatic" | "manual") => page.locator(`input[name=output-delay-mode][value=${mode}]`);
const delaySlider = (page: Page) => page.getByRole("slider", { name: "Manual output delay" });
const reported = (page: Page) => page.locator(".delay-reported");

test("Automatic delays the highlight by the output timestamp the browser reports", async ({ page }) => {
  await page.addInitScript(stubLatency, { timestampDelay: 0.4, baseLatency: 0.01, outputLatency: 0.02 });
  await page.goto("/");
  await expect(reported(page)).toHaveText("not reported");
  await expect(delayRadio(page, "automatic")).toBeChecked();
  await start(page);
  await expect(reported(page)).toHaveText("browser reports 400 ms");
  expectHighlightFollows(await highlightLags(page, 0.4));
  await stop(page);
});

test("Automatic keeps the latency of a Firefox output timestamp", async ({ page }) => {
  await page.addInitScript(stubLatency, { timestampDelay: null, firefoxTimestamp: true, baseLatency: 0, outputLatency: 0.35 });
  await page.goto("/");
  await start(page);
  await expect(reported(page)).toHaveText("browser reports 350 ms");
  expectHighlightFollows(await highlightLags(page, 0.35));
  await stop(page);
});

test("Automatic does not use an output timestamp later than now, as WebKit reports it", async ({ page }) => {
  await page.addInitScript(stubLatency, { timestampDelay: null, webkitTimestamp: true, baseLatency: 0.05, outputLatency: 0.15 });
  await page.goto("/");
  await start(page);
  // The base and output latency instead. The timestamp's error grows with the context time, so both are
  // checked after the first second.
  expectHighlightFollows(await highlightLags(page, 0.2));
  await expect(reported(page)).toHaveText("browser reports 200 ms");
  await stop(page);
});

test("without an output timestamp, Automatic uses the base and output latency", async ({ page }) => {
  await page.addInitScript(stubLatency, { timestampDelay: null, baseLatency: 0.05, outputLatency: 0.25 });
  await page.goto("/");
  await start(page);
  await expect(reported(page)).toHaveText("browser reports 300 ms");
  expectHighlightFollows(await highlightLags(page, 0.3));
  await stop(page);
});

test("with nothing reported, Automatic shows the note at the audio clock", async ({ page }) => {
  await page.addInitScript(stubLatency, { timestampDelay: null });
  await page.goto("/");
  await start(page);
  await waitForClicks(page, 8);
  await page.waitForTimeout(600);
  await expect(reported(page)).toHaveText("not reported");
  expectHighlightFollows(await highlightLags(page, 0));
  await stop(page);
});

test("Manual delays the highlight by the slider value, not the reported delay", async ({ page }) => {
  await page.addInitScript(stubLatency, { timestampDelay: 0.4, baseLatency: 0.01, outputLatency: 0.02 });
  await page.goto("/");
  await expect(delaySlider(page)).toHaveCount(0);
  await start(page);
  await expect(reported(page)).toHaveText("browser reports 400 ms");

  // The first switch to Manual starts at the reported delay.
  await delayRadio(page, "manual").check();
  await expect(delaySlider(page)).toHaveValue("400");
  await expect(page.locator(".delay-value")).toHaveText("400 ms");
  await slide(delaySlider(page), 150);
  await expect(page.locator(".delay-value")).toHaveText("150 ms");
  await expect(delaySlider(page)).toHaveAttribute("aria-valuetext", "150 ms");
  expectHighlightFollows(await highlightLags(page, 0.15));

  // Back to Automatic, then Manual again: the manual value is kept.
  await delayRadio(page, "automatic").check();
  await expect(delaySlider(page)).toHaveCount(0);
  // A longer delay holds the highlight on the last note shown until the heard time reaches the next one.
  await page.waitForTimeout(400);
  expectHighlightFollows(await highlightLags(page, 0.4));
  await delayRadio(page, "manual").check();
  await expect(delaySlider(page)).toHaveValue("150");
  await slide(delaySlider(page), 0);
  expectHighlightFollows(await highlightLags(page, 0));
  await stop(page);
});

test("the first switch to Manual starts at 0 when nothing is reported", async ({ page }) => {
  await page.addInitScript(stubLatency, { timestampDelay: null });
  await page.goto("/");
  await delayRadio(page, "manual").check();
  await expect(delaySlider(page)).toHaveValue("0");
});

test("the output delay setting survives a reload and Reset restores Automatic", async ({ page }) => {
  await page.goto("/");
  await delayRadio(page, "manual").check();
  await slide(delaySlider(page), 230);
  expect((await appState(page)).delay).toBe("manual:230");
  await page.reload();
  expect((await appState(page)).delay).toBe("manual:230");
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), KEY)).toMatchObject({
    outputDelayMode: "manual",
    manualOutputDelay: 230,
  });

  // Automatic keeps the manual value for the next switch.
  await delayRadio(page, "automatic").check();
  await page.reload();
  expect((await appState(page)).delay).toBe("automatic");
  await delayRadio(page, "manual").check();
  expect((await appState(page)).delay).toBe("manual:230");

  await page.getByRole("button", { name: "Reset settings" }).click();
  expect((await appState(page)).delay).toBe("automatic");
  await page.reload();
  expect((await appState(page)).delay).toBe("automatic");
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), KEY)).toMatchObject({
    outputDelayMode: "automatic",
    manualOutputDelay: null,
  });
  await expect(playButton(page)).toHaveText("Start");
});

test("the delay choice and slider have accessible names and the help text is shown", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("group", { name: "Output delay" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Automatic" })).toBeChecked();
  await page.getByRole("radio", { name: "Manual" }).check();
  await expect(delaySlider(page)).toBeVisible();
  await expect(page.locator(".delay-help")).toHaveText(
    "Bluetooth headphones and speakers usually add 40–300 ms. If the light and click don't line up, choose Manual and move the slider until they do.",
  );
});

// Init script: while held, animation frame callbacks wait, as on a hidden page; release requests them again.
// Runs in the page, so it must not use outer variables.
function holdableFrames() {
  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  const waiting = new Map<number, FrameRequestCallback>();
  let holding = false;
  let nextId = -1;
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    if (!holding) return request(callback);
    waiting.set(nextId, callback);
    return nextId--;
  };
  window.cancelAnimationFrame = (id: number) => {
    if (id < 0) waiting.delete(id);
    else cancel(id);
  };
  window.__frames = {
    hold() {
      holding = true;
    },
    release() {
      holding = false;
      for (const callback of waiting.values()) request(callback);
      waiting.clear();
    },
  };
}

// Init script: keeps a weak reference to every note the click worklet reports, to count those still
// referenced after garbage collection. Runs in the page, so it must not use outer variables.
function trackNotes() {
  const refs: WeakRef<object>[] = [];
  const Base = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends Base {
    constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
      super(context, name, options);
      this.port.addEventListener("message", (e: MessageEvent<object[]>) => {
        for (const note of e.data) refs.push(new WeakRef(note));
      });
    }
  };
  window.__noteRefs = {
    alive: () => refs.filter((r) => r.deref() !== undefined).length,
    count: () => refs.length,
  };
}

test.describe("hidden page (Chromium)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "collects garbage through the Chrome DevTools Protocol");

  test("while no animation frame runs, only the notes not yet heard are kept, and the highlight follows again after", async ({ page }) => {
    await page.addInitScript(stubLatency, { timestampDelay: 0.4, baseLatency: 0.01, outputLatency: 0.02 });
    await page.addInitScript(holdableFrames);
    await page.addInitScript(trackNotes);
    await page.goto("/");
    await start(page);
    await waitForClicks(page, 4);
    await page.evaluate(() => window.__frames.hold());
    await page.waitForTimeout(3000);
    // The fixture's records are cleared, so only the app references the notes.
    await clearClicks(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    const { alive, count } = await page.evaluate(() => ({ alive: window.__noteRefs.alive(), count: window.__noteRefs.count() }));
    expect(count, "notes reported").toBeGreaterThanOrEqual(24);
    // Notes within the 400 ms delay (at most 4) and the latest note heard.
    expect(alive, "notes still referenced").toBeLessThanOrEqual(5);

    await page.evaluate(() => window.__frames.release());
    // Past the notes reported before the records were cleared.
    await waitForClicks(page, 8);
    expectHighlightFollows(await highlightLags(page, 0.4));
    await stop(page);
  });
});
