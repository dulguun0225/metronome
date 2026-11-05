import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}/`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  // Timing checks (the stop fade, the highlight) need the page's timers and animation frames to run on time,
  // so CPU load is kept moderate.
  // Two workers also keep the run's memory use near 2 GB.
  workers: 2,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: {
          firefoxUserPrefs: { "media.autoplay.default": 0, "media.autoplay.block-webaudio": false },
        },
      },
    },
  ],
  // Tests run against the production build, which the server command builds first.
  webServer: {
    command: `pnpm run build && pnpm run preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
