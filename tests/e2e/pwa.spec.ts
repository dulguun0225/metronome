import { expect, start, stop, test, waitForClicks } from "./fixtures";

const DIST_INDEX = new URL("../../dist/index.html", import.meta.url).href;

test("the file:// build renders and plays", async ({ page }) => {
  await page.goto(DIST_INDEX);
  await expect(page.locator(".beat")).toHaveCount(4);
  await start(page);
  await waitForClicks(page, 8);
  await stop(page);
});

test.describe("installed app (Chromium)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "uses the Chrome DevTools Protocol");

  test("the manifest has no installability errors", async ({ page, context }) => {
    await page.goto("/");
    const cdp = await context.newCDPSession(page);
    const manifest = await cdp.send("Page.getAppManifest");
    expect(manifest.errors).toEqual([]);
    const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
    expect(installabilityErrors).toEqual([]);
  });
});
