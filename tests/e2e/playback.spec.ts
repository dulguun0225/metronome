import {
  ACCENT_HZ,
  accentCheckbox,
  BEAT_HZ,
  beatsOf,
  clearClicks,
  clicks,
  expect,
  expectedNotes,
  gridIndices,
  NOTE_120_4,
  outputGain,
  playButton,
  slide,
  start,
  stop,
  SUB_HZ,
  setSub,
  test,
  volumeSlider,
  waitForClicks,
  type Click,
  type ExpectedNote,
} from "./fixtures";

// Pitch and relative level of note `i` of a 4/4 bar with 4 subdivisions per beat, given the accented beats.
function pattern(i: number, accented = [true, false, false, false]) {
  const sub = i % 4;
  const beatIndex = Math.floor(i / 4) % 4;
  if (sub > 0) return { hz: SUB_HZ, peak: 0.5 };
  return accented[beatIndex] ? { hz: ACCENT_HZ, peak: 1 } : { hz: BEAT_HZ, peak: 0.7 };
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

test("an unchecked note is silent but still highlighted", async ({ page }) => {
  await setSub(page, 0, 1, false);
  await start(page);
  // Two bars: 32 positions, two of them silent.
  const list = (await waitForClicks(page, 30)).slice(0, 30);
  const indices = gridIndices(list, NOTE_120_4);
  const expected = Array.from({ length: 32 }, (_, i) => i).filter((i) => i % 16 !== 1);
  expect(indices).toEqual(expected);
  await page.waitForFunction(
    () => {
      const sub = document.querySelectorAll(".beat")[0].querySelectorAll(".sub")[1];
      return sub.classList.contains("active") && sub.classList.contains("off");
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

  // Beat count lowered to 3 and the accent moved to beat 3.
  const n1 = await page.evaluate(() => {
    const n = window.__audio.clicks.length;
    const count = document.querySelector("#beat-count") as HTMLInputElement;
    count.value = "3";
    count.dispatchEvent(new Event("change", { bubbles: true }));
    (document.querySelectorAll(".beat")[0].querySelector(".accent-toggle input") as HTMLInputElement).click();
    (document.querySelectorAll(".beat")[2].querySelector(".accent-toggle input") as HTMLInputElement).click();
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

test("accent toggles set the beat start pitch; an unchecked accented note is silent", async ({ page }) => {
  const play = async (count: number) => {
    await clearClicks(page);
    await start(page);
    const list = (await waitForClicks(page, count)).slice(0, count);
    await stop(page);
    return list;
  };

  let list = await play(16);
  expect(list.map((c) => c.hz)).toEqual(list.map((_, i) => pattern(i).hz));

  await accentCheckbox(page, 2).check();
  await accentCheckbox(page, 0).uncheck();
  await expect(page.locator(".beat.accent")).toHaveCount(1);
  await expect(page.locator(".beat").nth(2)).toHaveClass(/accent/);
  list = await play(16);
  const accented = [false, false, true, false];
  list.forEach((c, i) => expect({ hz: c.hz, peak: c.peak }, `note ${i}`).toEqual(pattern(i, accented)));

  await setSub(page, 2, 0, false);
  list = await play(15);
  expect(list.filter((c) => c.hz === ACCENT_HZ)).toEqual([]);
  expect(gridIndices(list, NOTE_120_4)).toEqual(Array.from({ length: 16 }, (_, i) => i).filter((i) => i !== 8));
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
  expect(Object.fromEntries(levels)).toEqual({ [ACCENT_HZ]: 1, [BEAT_HZ]: 0.7, [SUB_HZ]: 0.5 });

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
