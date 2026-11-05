import {
  clearClicks,
  commit,
  countField,
  DEFAULT_STATE,
  expect,
  gridIndices,
  NOTE_120_4,
  playButton,
  setSub,
  slide,
  start,
  stop,
  subdivisionRadio,
  tempoField,
  test,
  volumeSlider,
  waitForClicks,
  appState,
} from "./fixtures";
import type { Page } from "@playwright/test";

const KEY = "metronome:/:settings";

// Tempo 87, volume 35, six beats with custom subdivisions and levels, then the count lowered to 3.
async function customize(page: Page) {
  await commit(tempoField(page), 87);
  await commit(countField(page), 6);
  await expect(page.locator(".beat")).toHaveCount(6);
  for (const [b, n] of [[0, 3], [1, 8], [4, 2], [5, 6]]) await subdivisionRadio(page, b, n).check();
  for (const [b, i] of [[0, 1], [1, 5], [4, 0], [5, 3]]) await setSub(page, b, i, "mute");
  await setSub(page, 0, 0, "accent");
  await setSub(page, 1, 2, "accent");
  await setSub(page, 1, 3, "maxAccent");
  await setSub(page, 2, 0, "maxAccent");
  await setSub(page, 5, 0, "maxAccent");
  await slide(volumeSlider(page), 35);
  await commit(countField(page), 3);
  await expect(page.locator(".beat")).toHaveCount(3);
}

const CUSTOM_3 = {
  tempo: "87",
  slider: "87",
  count: "3",
  volume: "35",
  beats: ["3:201", "8:21231011", "4:3111"],
};
const CUSTOM_6 = { ...CUSTOM_3, count: "6", beats: [...CUSTOM_3.beats, "4:2111", "2:01", "6:311011"] };

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".beat")).toHaveCount(4);
});

test("starts with the defaults", async ({ page }) => {
  expect(await appState(page)).toEqual(DEFAULT_STATE);
});

test("beat settings are kept when the count is lowered then raised", async ({ page }) => {
  await customize(page);
  expect(await appState(page)).toEqual(CUSTOM_3);
  await commit(countField(page), 6);
  expect(await appState(page)).toEqual(CUSTOM_6);
  // Beats never shown before get the defaults.
  await page.getByRole("button", { name: "More beats" }).click();
  expect((await appState(page)).beats[6]).toBe("4:2111");
});

test("Reset restores every default, also while playing", async ({ page }) => {
  await customize(page);
  await page.getByRole("button", { name: "Reset settings" }).click();
  expect(await appState(page)).toEqual(DEFAULT_STATE);
  await commit(countField(page), 6);
  expect((await appState(page)).beats).toEqual(Array.from({ length: 6 }, (_, i) => (i === 0 ? "4:3111" : "4:2111")));

  await commit(countField(page), 4);
  await start(page);
  await customize(page);
  await page.getByRole("button", { name: "Reset settings" }).click();
  await expect(playButton(page)).toHaveText("Stop");
  expect(await appState(page)).toEqual(DEFAULT_STATE);
  await clearClicks(page);
  // Wait past notes scheduled before the reset, then check the default bar.
  const list = (await waitForClicks(page, 24)).slice(4);
  const indices = gridIndices(list, NOTE_120_4);
  expect(indices).toEqual(list.map((_, i) => i));
  expect(await page.evaluate(() => window.__audio.outputGain())).toBeCloseTo(0.8, 6);
  await stop(page);
});

test("settings survive a reload; playing state does not", async ({ page }) => {
  await customize(page);
  await start(page);
  await page.reload();
  await expect(page.locator(".beat")).toHaveCount(3);
  expect(await appState(page)).toEqual(CUSTOM_3);
  await expect(playButton(page)).toHaveText("Start");
  await commit(countField(page), 6);
  expect(await appState(page)).toEqual(CUSTOM_6);

  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), KEY);
  expect(stored).toMatchObject({ version: 2, tempo: 87, beatCount: 6, volume: 0.35 });
  expect(stored.beats).toHaveLength(6);
  expect(stored.beats[1]).toEqual({
    subDivision: 8,
    levels: ["accent", "normal", "accent", "maxAccent", "normal", "mute", "normal", "normal"],
  });

  // Reset is saved too.
  await page.getByRole("button", { name: "Reset settings" }).click();
  await page.reload();
  expect(await appState(page)).toEqual(DEFAULT_STATE);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), KEY)).toMatchObject({
    version: 2,
    tempo: 120,
    beatCount: 4,
    volume: 0.8,
  });
});

test("stored data with bad fields is clamped or replaced by defaults", async ({ page }) => {
  await page.evaluate((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        tempo: 999,
        beatCount: 2,
        volume: "loud",
        beats: [{ subDivision: 12, levels: ["mute", "loud"] }, null],
      }),
    );
  }, KEY);
  await page.reload();
  expect(await appState(page)).toEqual({
    tempo: "300",
    slider: "300",
    count: "2",
    volume: "80",
    beats: ["8:31111111", "4:2111"],
  });

  await page.evaluate((key) => localStorage.setItem(key, "{not json"), KEY);
  await page.reload();
  expect(await appState(page)).toEqual(DEFAULT_STATE);
});

test("stored data of version 1 is ignored", async ({ page }) => {
  await page.evaluate((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        tempo: 87,
        beatCount: 3,
        volume: 0.35,
        beats: [0, 1, 2].map(() => ({ subDivision: 2, enabled: Array(8).fill(false), accent: true })),
      }),
    );
  }, KEY);
  await page.reload();
  expect(await appState(page)).toEqual(DEFAULT_STATE);
});

test("blocked storage does not break the app", async ({ page }) => {
  await page.addInitScript(() => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    Storage.prototype.getItem = blocked;
    Storage.prototype.setItem = blocked;
  });
  await page.reload();
  expect(await appState(page)).toEqual(DEFAULT_STATE);
  await commit(tempoField(page), 100);
  await expect(tempoField(page)).toHaveValue("100");
  await start(page);
  await waitForClicks(page, 4);
  await stop(page);
});
