// Offline support for the hosted build. Paths are relative to this script, so the
// site works under any subpath. The page is fetched network-first, so a new build
// reaches online users without changing VERSION; change VERSION only when the
// manifest or icons change.
const VERSION = "2";

// One origin can host several sites (e.g. GitHub Pages project sites), and they share
// Cache Storage, so cache names include this registration's scope and only caches
// with this scope's prefix are ever deleted.
const PREFIX = "metronome:" + self.registration.scope + ":";
const CACHE = PREFIX + VERSION;

const PAGE_URLS = ["./", "./index.html"].map((p) => new URL(p, self.location.href).href);
const ASSET_URLS = [
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
].map((p) => new URL(p, self.location.href).href);
const PRECACHE = new Set([...PAGE_URLS, ...ASSET_URLS]);

// A response that followed a redirect must not be returned for a navigation, so store
// a copy without the redirect flag.
async function storable(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        [...PRECACHE].map(async (url) => {
          const response = await fetch(url, { cache: "reload" });
          if (!response.ok) throw new Error("precache failed: " + url + " " + response.status);
          await cache.put(url, await storable(response));
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith(PREFIX) && n !== CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

async function networkFirstPage(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    const url = new URL(request.url);
    url.search = "";
    url.hash = "";
    // "./" and "./index.html" are the same document; keep both entries current.
    if (response.ok && response.type === "basic" && PAGE_URLS.includes(url.href)) {
      const copy = await storable(response.clone());
      const body = await copy.blob();
      await Promise.all(
        PAGE_URLS.map((u) =>
          cache.put(u, new Response(body, { status: copy.status, statusText: copy.statusText, headers: copy.headers })),
        ),
      );
    }
    return response;
  } catch (error) {
    const cached =
      (await cache.match(request, { ignoreSearch: true })) ?? (await cache.match(PAGE_URLS[0]));
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request, key) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") await cache.put(key, await storable(response.clone()));
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  url.search = "";
  url.hash = "";
  if (request.mode === "navigate" || PAGE_URLS.includes(url.href)) {
    event.respondWith(networkFirstPage(request));
  } else if (PRECACHE.has(url.href)) {
    event.respondWith(cacheFirst(request, url.href));
  }
});
