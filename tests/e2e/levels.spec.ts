import { appState, bandPosition, beat, expect, expectLevel, LEVEL_ORDER, subSlider, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".beat")).toHaveCount(4);
});

test("a level slider states its range, value and name", async ({ page }) => {
  const slider = subSlider(page, 0, 0);
  await expect(slider).toHaveAttribute("aria-orientation", "vertical");
  await expect(slider).toHaveAttribute("aria-valuemin", "0");
  await expect(slider).toHaveAttribute("aria-valuemax", "3");
  await expect(slider).toHaveAttribute("tabindex", "0");
  await expectLevel(slider, "maxAccent");
});

test("a click in each band sets that level", async ({ page }) => {
  const slider = subSlider(page, 1, 2);
  for (const level of ["mute", "maxAccent", "normal", "mute", "accent"] as const) {
    await slider.click({ position: await bandPosition(slider, level) });
    await expectLevel(slider, level);
  }
  // Other subdivisions are unchanged.
  expect((await appState(page)).beats).toEqual(["4:3111", "4:2121", "4:2111", "4:2111"]);
});

test("a click with a mouse button other than the primary one does not change the level", async ({ page }) => {
  const slider = subSlider(page, 1, 1);
  await slider.click({ button: "right", position: await bandPosition(slider, "maxAccent") });
  await slider.click({ button: "middle", position: await bandPosition(slider, "maxAccent") });
  await expectLevel(slider, "normal");
});

test("a drag sets the level live and clamps beyond the cell", async ({ page }) => {
  const slider = subSlider(page, 2, 1);
  const box = (await slider.boundingBox())!;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + box.height - 2);
  await page.mouse.down();
  await expectLevel(slider, "mute");
  for (const level of LEVEL_ORDER) {
    const { y } = await bandPosition(slider, level);
    await page.mouse.move(x, box.y + y, { steps: 3 });
    await expectLevel(slider, level);
  }
  await page.mouse.move(x, box.y - 60, { steps: 5 });
  await expectLevel(slider, "maxAccent");
  await page.mouse.move(x, box.y + box.height + 60, { steps: 10 });
  await expectLevel(slider, "mute");
  await page.mouse.up();
  // After release, moving over the cell no longer changes the level.
  await page.mouse.move(x, box.y + 2, { steps: 3 });
  await expectLevel(slider, "mute");
  expect((await appState(page)).beats[2]).toBe("4:2011");
});

test("each level band is at least 11 px tall on a 390 px wide screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await beat(page, 0).locator(`input[type=radio][value="8"]`).check();
  const box = (await subSlider(page, 0, 7).boundingBox())!;
  expect(box.height / LEVEL_ORDER.length).toBeGreaterThanOrEqual(11);
});
