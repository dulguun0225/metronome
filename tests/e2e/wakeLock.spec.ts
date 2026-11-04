import { expect, start, stop, test } from "./fixtures";
import type { Page } from "@playwright/test";

const wakeLog = (page: Page) => page.evaluate(() => window.__wakeLock.log.slice());
const held = (page: Page) => page.evaluate(() => window.__wakeLock.held());

test("the screen wake lock is held while playing", async ({ page }) => {
  await page.goto("/");
  await start(page);
  await expect.poll(() => held(page)).toBe(1);
  expect(await wakeLog(page)).toEqual(["request:screen"]);
  await stop(page);
  await expect.poll(() => held(page)).toBe(0);
  expect(await wakeLog(page)).toEqual(["request:screen", "release"]);
});

test("the wake lock is requested again when the page is visible again while playing", async ({ page }) => {
  await page.goto("/");
  await start(page);
  await expect.poll(() => held(page)).toBe(1);
  // The browser releases the lock while the page is hidden.
  await page.evaluate(() => {
    window.__wakeLock.releaseByBrowser();
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => held(page)).toBe(1);
  expect(await wakeLog(page)).toEqual(["request:screen", "browser-release", "request:screen"]);
  // A held lock is not requested twice.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await stop(page);
  await expect.poll(() => held(page)).toBe(0);
  // Not while stopped.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(100);
  expect(await wakeLog(page)).toEqual(["request:screen", "browser-release", "request:screen", "release"]);
});

test("playback works without the Wake Lock API or with a failing one", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
    });
  });
  await page.goto("/");
  await start(page);
  await page.waitForFunction(() => window.__audio.clicks.length > 4);
  await stop(page);

  await page.addInitScript(() => {
    delete (navigator as { wakeLock?: unknown }).wakeLock;
    delete (Navigator.prototype as { wakeLock?: unknown }).wakeLock;
  });
  await page.reload();
  expect(await page.evaluate(() => "wakeLock" in navigator)).toBe(false);
  await start(page);
  await page.waitForFunction(() => window.__audio.clicks.length > 4);
  await stop(page);
});

test("the audio session type is set to playback before audio starts", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } });
  });
  await page.goto("/");
  await start(page);
  expect(await page.evaluate(() => (navigator as Navigator & { audioSession: { type: string } }).audioSession.type)).toBe("playback");
  expect(await page.evaluate(() => window.__audio.sessionTypes)).toEqual(["playback"]);
  await stop(page);
});
