import {
  ACCENT_HZ,
  beatsOf,
  CLICK_OF,
  clearClicks,
  clicks,
  expect,
  expectedNotes,
  gridIndices,
  MAX_ACCENT_HZ,
  NORMAL_HZ,
  NOTE_120_4,
  outputGain,
  playButton,
  slide,
  start,
  stop,
  setSub,
  subButton,
  test,
  volumeSlider,
  waitForClicks,
  type Click,
  type ExpectedNote,
} from "./fixtures";

// Pitch and peak gain of note `i` of a 4/4 bar with 4 subdivisions per beat and default levels, given the beats
// whose first subdivision is at max accent (the others are at accent).
function pattern(i: number, maxAccented = [true, false, false, false]) {
  const sub = i % 4;
  const beatIndex = Math.floor(i / 4) % 4;
  if (sub > 0) return CLICK_OF.normal;
  return maxAccented[beatIndex] ? CLICK_OF.maxAccent : CLICK_OF.accent;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".beat")).toHaveCount(4);
});

test("plays 120 BPM 4/4 with four subdivisions at the right times, pitches and levels", async ({ page }) => {
  await start(page);
  const list = await waitForClicks(page, 20);
  for (let i = 1; i < list.length; i++) expect(list[i].time - list[i - 1].time).toBeCloseTo(NOTE_120_4, 6);
  list.forEach((c, i) => expect({ hz: c.hz, peak: c.peak }, `note ${i}`).toEqual(pattern(i)));
  expect(await outputGain(page)).toBeCloseTo(0.8, 6);

  // The sounding beat and subdivision are highlighted, one at a time.
  await page.waitForFunction(() => document.querySelectorAll(".beat")[2].classList.contains("active"), null, { polling: "raf" });
  const counts = await page.evaluate(async () => {
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      seen.add(document.querySelectorAll(".beat.active").length * 10 + document.querySelectorAll(".sub.active").length);
      await new Promise(requestAnimationFrame);
    }
    return [...seen];
  });
  expect(counts).toEqual([11]);

  await stop(page);
  await expect(page.locator(".beat.active, .sub.active, .bar-dot.active")).toHaveCount(0);
  const after = (await clicks(page)).length;
  await page.waitForTimeout(400);
  expect((await clicks(page)).length).toBe(after);

  // A restart reuses the AudioContext with a new output node.
  await start(page);
  await waitForClicks(page, after + 2);
  expect(await page.evaluate(() => [window.__audio.contexts.length, window.__audio.outputs.length])).toEqual([1, 2]);
  await stop(page);
});

test("a muted note is silent but still highlighted", async ({ page }) => {
  await setSub(page, 0, 1, "mute");
  await start(page);
  // Two bars: 32 positions, two of them silent.
  const list = (await waitForClicks(page, 30)).slice(0, 30);
  const indices = gridIndices(list, NOTE_120_4);
  const expected = Array.from({ length: 32 }, (_, i) => i).filter((i) => i % 16 !== 1);
  expect(indices).toEqual(expected);
  await page.waitForFunction(
    () => {
      const sub = document.querySelectorAll(".beat")[0].querySelectorAll(".sub")[1];
      return sub.classList.contains("active") && (sub as HTMLElement).dataset.level === "mute";
    },
    null,
    { polling: "raf", timeout: 5000 },
  );
  await stop(page);
});

test("changes while playing apply from the next note", async ({ page }) => {
  await start(page);
  await waitForClicks(page, 6);

  // Subdivision of beat 2 to 3 and tempo to 90, in one task so no note is scheduled between them.
  const n0 = await page.evaluate(() => {
    const n = window.__audio.clicks.length;
    (document.querySelectorAll(".beat")[1].querySelector('input[type=radio][value="3"]') as HTMLInputElement).click();
    const tempo = document.querySelector("#tempo") as HTMLInputElement;
    tempo.value = "90";
    tempo.dispatchEvent(new Event("change", { bubbles: true }));
    return n;
  });
  let list = await waitForClicks(page, n0 + 24);
  // Notes scheduled before the change are on the old grid.
  const before = list.slice(0, n0);
  expect(gridIndices(before, NOTE_120_4)).toEqual(before.map((_, i) => i));
  const lastIndex = n0 - 1;
  const last: ExpectedNote = {
    beat: Math.floor(lastIndex / 4) % 4,
    sub: lastIndex % 4,
    time: list[lastIndex].time,
    ...pattern(lastIndex),
  };
  const check = (actual: Click[], expected: ExpectedNote[]) =>
    expected.forEach((e, i) => {
      expect(actual[i].time, `note ${i} time`).toBeCloseTo(e.time, 6);
      expect({ hz: actual[i].hz, peak: actual[i].peak }, `note ${i}`).toEqual({ hz: e.hz, peak: e.peak });
    });
  const afterChange = expectedNotes(last, 24, 90, 4, beatsOf([4, 3, 4, 4]));
  check(list.slice(n0, n0 + 24), afterChange);

  // Beat count lowered to 3 and the max accent moved to beat 3: its first subdivision steps from accent to
  // max accent, that of beat 1 from max accent through mute and normal to accent.
  const n1 = await page.evaluate(() => {
    const n = window.__audio.clicks.length;
    const count = document.querySelector("#beat-count") as HTMLInputElement;
    count.value = "3";
    count.dispatchEvent(new Event("change", { bubbles: true }));
    const firstSub = (b: number) => document.querySelectorAll(".beat")[b].querySelector(".sub") as HTMLButtonElement;
    for (let i = 0; i < 3; i++) firstSub(0).click();
    firstSub(2).click();
    return n;
  });
  list = await waitForClicks(page, n1 + 20);
  // Continue the expected sequence under the first change up to the last note scheduled before the second.
  const upToSecond = expectedNotes(last, n1 - n0, 90, 4, beatsOf([4, 3, 4, 4]));
  check(list.slice(n0, n1), upToSecond);
  const afterSecond = expectedNotes(upToSecond[upToSecond.length - 1], 20, 90, 3, beatsOf([4, 3, 4, 4], [false, false, true, false]));
  check(list.slice(n1, n1 + 20), afterSecond);
  await stop(page);
});

test("each level sets the click pitch and gain; mute is silent; a max accent marks the beat", async ({ page }) => {
  const play = async (count: number) => {
    await clearClicks(page);
    await start(page);
    const list = (await waitForClicks(page, count)).slice(0, count);
    await stop(page);
    return list;
  };

  let list = await play(16);
  list.forEach((c, i) => expect({ hz: c.hz, peak: c.peak }, `note ${i}`).toEqual(pattern(i)));
  await expect(page.locator(".beat.accent")).toHaveCount(1);
  await expect(page.locator(".beat").nth(0)).toHaveClass(/accent/);
  await expect(page.locator(".bar-dot.accent")).toHaveCount(1);
  await expect(page.locator(".bar-dot").nth(0)).toHaveClass(/accent/);

  // Beat 2 gets all four levels; the max accent moves from beat 1 to beat 3.
  await setSub(page, 1, 0, "mute");
  await setSub(page, 1, 1, "normal");
  await setSub(page, 1, 2, "accent");
  await setSub(page, 1, 3, "maxAccent");
  await setSub(page, 0, 0, "accent");
  await setSub(page, 2, 0, "maxAccent");
  await expect(page.locator(".beat.accent")).toHaveCount(1);
  await expect(page.locator(".beat").nth(2)).toHaveClass(/accent/);
  await expect(page.locator(".bar-dot.accent")).toHaveCount(1);
  await expect(page.locator(".bar-dot").nth(2)).toHaveClass(/accent/);

  list = await play(15);
  // Bar positions: beat 2 starts at 4, muted.
  const positions = Array.from({ length: 16 }, (_, i) => i).filter((i) => i !== 4);
  expect(gridIndices(list, NOTE_120_4)).toEqual(positions);
  const expected = (i: number) => {
    if (i === 5) return CLICK_OF.normal;
    if (i === 6) return CLICK_OF.accent;
    if (i === 7) return CLICK_OF.maxAccent;
    return pattern(i, [false, false, true, false]);
  };
  list.forEach((c, k) => expect({ hz: c.hz, peak: c.peak }, `position ${positions[k]}`).toEqual(expected(positions[k])));
  expect(await subButton(page, 1, 0).getAttribute("data-level")).toBe("mute");
});

test("the volume slider sets the master volume live; click levels stay relative", async ({ page }) => {
  await expect(volumeSlider(page)).toHaveValue("80");
  await expect(page.locator(".volume-value")).toHaveText("80%");
  await start(page);
  await waitForClicks(page, 4);
  expect(await outputGain(page)).toBeCloseTo(0.8, 6);

  await slide(volumeSlider(page), 50);
  await expect(page.locator(".volume-value")).toHaveText("50%");
  // Applied to the running output node; no restart.
  expect(await outputGain(page)).toBeCloseTo(0.5, 6);
  expect(await page.evaluate(() => window.__audio.outputs.length)).toBe(1);
  // The node's actual gain follows within a few time constants.
  await expect.poll(() => page.evaluate(() => window.__audio.outputs[0].gain.value), { timeout: 3000 }).toBeCloseTo(0.5, 2);

  await clearClicks(page);
  const list = await waitForClicks(page, 16);
  const levels = new Map(list.map((c) => [c.hz, c.peak]));
  expect(Object.fromEntries(levels)).toEqual({ [MAX_ACCENT_HZ]: 1, [ACCENT_HZ]: 0.7, [NORMAL_HZ]: 0.5 });

  await slide(volumeSlider(page), 0);
  expect(await outputGain(page)).toBe(0);
  await stop(page);

  // A new run starts at the current volume.
  await slide(volumeSlider(page), 25);
  await start(page);
  expect(await page.evaluate(() => window.__audio.outputs.length)).toBe(2);
  expect(await outputGain(page)).toBeCloseTo(0.25, 6);
  await stop(page);
  await expect(playButton(page)).toHaveText("Start");
});
