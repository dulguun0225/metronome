import { beat, countField, expect, playButton, subCheckbox, tempoField, tempoSlider, test } from "./fixtures";
import type { Page } from "@playwright/test";

async function blur(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function expectState(page: Page, state: { button?: string; tempo?: string; slider?: string; count?: string }) {
  if (state.button !== undefined) await expect(playButton(page)).toHaveText(state.button);
  if (state.tempo !== undefined) await expect(tempoField(page)).toHaveValue(state.tempo);
  if (state.slider !== undefined) await expect(tempoSlider(page)).toHaveValue(state.slider);
  if (state.count !== undefined) await expect(countField(page)).toHaveValue(state.count);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".beat")).toHaveCount(4);
});

test("Space starts and stops; arrows change the tempo", async ({ page }) => {
  await page.keyboard.press("Space");
  await expectState(page, { button: "Stop" });
  await page.waitForFunction(() => window.__audio.clicks.length > 0);
  await page.keyboard.press("Space");
  await expectState(page, { button: "Start" });

  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expectState(page, { tempo: "122", slider: "122" });
  await page.keyboard.press("ArrowDown");
  await expectState(page, { tempo: "121", slider: "121" });
});

test("the tempo is clamped by the arrow keys", async ({ page }) => {
  for (let i = 0; i < 185; i++) await page.keyboard.press("ArrowUp");
  await expectState(page, { tempo: "300", slider: "300" });
  await expect(page.getByRole("button", { name: "Increase tempo" })).toBeDisabled();
  await commitTempo(page, 25);
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowDown");
  await expectState(page, { tempo: "20", slider: "20" });
  await expect(page.getByRole("button", { name: "Decrease tempo" })).toBeDisabled();
});

async function commitTempo(page: Page, value: number) {
  await tempoField(page).fill(String(value));
  await tempoField(page).blur();
}

test("T taps the tempo", async ({ page }) => {
  await page.keyboard.press("t");
  await page.waitForTimeout(400);
  await page.keyboard.press("T");
  // One interval of about 400 ms; the press itself adds a little.
  const tempo = Number(await tempoField(page).inputValue());
  expect(tempo).toBeGreaterThanOrEqual(110);
  expect(tempo).toBeLessThanOrEqual(150);
});

test("keys typed into a number field are left to the field", async ({ page }) => {
  // The field steps its own value by one (the shortcut does not add a second step).
  await tempoField(page).focus();
  await page.keyboard.press("ArrowUp");
  await expectState(page, { tempo: "121", slider: "121" });
  await blur(page);

  // Space and T are typed into the field (the tempo slider shows the tempo, so a tap would move it).
  for (const field of [tempoField(page), countField(page)]) {
    await field.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("t");
    await page.waitForTimeout(300);
    await page.keyboard.press("t");
    await expectState(page, { button: "Start", slider: "121" });
    await blur(page);
  }
  await expectState(page, { count: "4" });
});

test("Space on a focused button toggles playback instead of clicking it", async ({ page }) => {
  await page.getByRole("button", { name: "More beats" }).focus();
  await page.keyboard.press("Space");
  await expectState(page, { button: "Stop", count: "4" });
  await playButton(page).focus();
  await page.keyboard.press("Space");
  await expectState(page, { button: "Start" });
});

test("Space on a checkbox and arrows on radios and sliders keep their own meaning", async ({ page }) => {
  const checkbox = subCheckbox(page, 1, 0);
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).not.toBeChecked();
  await expectState(page, { button: "Start" });
  // Arrows on a checkbox change the tempo.
  await page.keyboard.press("ArrowUp");
  await expectState(page, { tempo: "121" });

  const radio = beat(page, 3).locator("input[type=radio]:checked");
  await radio.focus();
  await page.keyboard.press("ArrowDown");
  await expect(beat(page, 3).locator("input[type=radio]:checked")).toHaveValue("5");
  await expectState(page, { tempo: "121" });

  await tempoSlider(page).focus();
  await page.keyboard.press("ArrowUp");
  await expectState(page, { tempo: "122", slider: "122" });

  await page.locator(".volume-slider").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".volume-slider")).toHaveValue("79");
  await expectState(page, { tempo: "122" });
});
