import { expect, start, stop, test, waitForClicks } from "./fixtures";

const DIST_INDEX = new URL("../../dist/index.html", import.meta.url).href;

test("the file:// build renders and plays without registering a service worker", async ({ page }) => {
  await page.goto(DIST_INDEX);
  await expect(page.locator(".beat")).toHaveCount(4);
  await start(page);
  await waitForClicks(page, 8);
  await stop(page);
  // Registration is skipped after the load event, so wait for it.
  await page.waitForFunction(() => document.readyState === "complete");
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__swRegisterCalls)).toBe(0);
});

test.describe("installed app (Chromium)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "uses the Chrome DevTools Protocol and Chromium's offline mode");

  test("the service worker installs and controls the page", async ({ page, baseURL }) => {
    await page.goto("/");
    const sw = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
      }
      const cached: string[] = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) cached.push(new URL(request.url).pathname);
      }
      return {
        registerCalls: window.__swRegisterCalls,
        scope: registration.scope,
        state: registration.active?.state,
        controller: navigator.serviceWorker.controller?.scriptURL,
        cacheNames: await caches.keys(),
        cached: cached.sort(),
      };
    });
    expect(sw).toEqual({
      registerCalls: 1,
      scope: baseURL,
      state: "activated",
      controller: `${baseURL}sw.js`,
      cacheNames: [`metronome:${baseURL}:2`],
      cached: [
        "/",
        "/apple-touch-icon.png",
        "/icon-192.png",
        "/icon-512.png",
        "/icon-maskable-512.png",
        "/index.html",
        "/manifest.webmanifest",
      ],
    });
  });

  test("the manifest has no installability errors", async ({ page, context }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cdp = await context.newCDPSession(page);
    const manifest = await cdp.send("Page.getAppManifest");
    expect(manifest.errors).toEqual([]);
    const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
    expect(installabilityErrors).toEqual([]);
  });

  test("the app loads and plays offline after the first visit", async ({ page, context }) => {
    await page.goto("/");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
      }
    });
    await context.setOffline(true);
    // The network is off for the page and for the service worker's own requests.
    const probe = () => fetch("/manifest.webmanifest?probe", { cache: "no-store" }).then(() => "online", () => "offline");
    expect(await page.evaluate(() => fetch("/not-cached.txt").then(() => "online", () => "offline"))).toBe("offline");
    const [worker] = context.serviceWorkers();
    expect(worker).toBeDefined();
    expect(await worker.evaluate(probe)).toBe("offline");

    await page.reload();
    await expect(page.locator(".beat")).toHaveCount(4);
    await start(page);
    await waitForClicks(page, 8);
    await stop(page);

    await page.goto("/index.html?from=offline");
    await expect(page.locator(".beat")).toHaveCount(4);
    await context.setOffline(false);
  });
});
