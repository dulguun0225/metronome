// Earlier versions registered this service worker for offline use. This version deletes the caches
// they made and unregisters itself; installed copies update to it on their next visit.
// Delete this file once those have updated.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const prefix = "metronome:" + self.registration.scope + ":";
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(prefix)).map((n) => caches.delete(n)));
      await self.registration.unregister();
    })(),
  );
});
