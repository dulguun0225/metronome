// Keeps the screen on while enabled, using the Screen Wake Lock API where available.
// The browser releases the lock when the page is hidden; call reacquire() when it is visible again.
// All errors (unsupported, denied, page hidden) are ignored.
export class ScreenWakeLock {
  #wanted = false;
  #sentinel: WakeLockSentinel | null = null;
  #requesting = false;
  // Set when an acquire is asked for while a request is in flight, so it is tried again once that request settles.
  #again = false;

  enable() {
    this.#wanted = true;
    void this.#acquire();
  }

  disable() {
    this.#wanted = false;
    const sentinel = this.#sentinel;
    this.#sentinel = null;
    sentinel?.release().catch(() => {});
  }

  reacquire() {
    if (this.#wanted) void this.#acquire();
  }

  async #acquire() {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    if (this.#sentinel && !this.#sentinel.released) return;
    if (this.#requesting) {
      this.#again = true;
      return;
    }
    this.#requesting = true;
    this.#again = false;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      if (this.#wanted && !this.#sentinel) {
        this.#sentinel = sentinel;
        sentinel.addEventListener("release", () => {
          if (this.#sentinel === sentinel) this.#sentinel = null;
        });
      } else {
        // Disabled while the request was in flight.
        sentinel.release().catch(() => {});
      }
    } catch {
      // Unsupported, not allowed, or the page was hidden.
    } finally {
      this.#requesting = false;
    }
    if (this.#again && this.#wanted) void this.#acquire();
  }
}
