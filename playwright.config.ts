import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}/`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  // Audio timing checks need the page's scheduler timer to run on time, so CPU load is kept moderate.
  workers: 4,
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
