import { defineConfig } from "vitest/config";
import { workletCode } from "./vite.config.ts";

export default defineConfig({
  // src/metronome.ts imports the worklet code.
  plugins: [workletCode()],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
