import { expect, playButton, start, stop, tapButton, tempoField, test, waitForClicks } from "./fixtures";

test("taps set the tempo from the mean of the last four intervals", async ({ page }) => {
  // A fake clock makes the tap times exact.
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:10Z"));
  await page.goto("/");
  await expect(page.locator(".beat")).toHaveCount(4);
  const tap = async (gapMs: number) => {
    await page.clock.runFor(gapMs);
    await tapButton(page).click();
  };

  await tap(0);
  await expect(tempoField(page)).toHaveValue("120");
  for (let i = 0; i < 4; i++) await tap(400);
  await expect(tempoField(page)).toHaveValue("150");
  await expect(page.locator(".tempo-marking")).toHaveText("Allegro");

  // A fifth interval replaces the oldest: 400, 400, 400, 1000 -> 550 ms.
  await tap(1000);
  await expect(tempoField(page)).toHaveValue("109");

  // A gap over 2 s starts a new sequence; its first tap leaves the tempo.
  await tap(2100);
  await expect(tempoField(page)).toHaveValue("109");
  await tap(600);
  await expect(tempoField(page)).toHaveValue("100");

  // The T key and the button add to the same sequence; a keyboard click on the button counts once.
  await page.clock.runFor(750);
  await page.keyboard.press("t");
  await expect(tempoField(page)).toHaveValue("89");
  await tapButton(page).focus();
  await page.clock.runFor(750);
  await page.keyboard.press("Enter");
  await expect(tempoField(page)).toHaveValue("86");
  await expect(playButton(page)).toHaveText("Start");

  // Fast taps clamp to 300 BPM.
  await tap(2500);
  for (let i = 0; i < 3; i++) await tap(100);
  await expect(tempoField(page)).toHaveValue("300");
});

test("tapping while playing changes only the tempo", async ({ page }) => {
  await page.goto("/");
  await start(page);
  for (let i = 0; i < 4; i++) {
    await tapButton(page).click();
    await page.waitForTimeout(300);
  }
  const tempo = Number(await tempoField(page).inputValue());
  expect(tempo).toBeGreaterThanOrEqual(150);
  expect(tempo).toBeLessThanOrEqual(205);
  await expect(playButton(page)).toHaveText("Stop");

  // Clicks continue at the tapped tempo.
  const n = await page.evaluate(() => window.__audio.clicks.length);
  const list = (await waitForClicks(page, n + 10)).slice(n);
  for (let i = 1; i < list.length; i++) expect(list[i].time - list[i - 1].time).toBeCloseTo(60 / tempo / 4, 6);
  await stop(page);
});
