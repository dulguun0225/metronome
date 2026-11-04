import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  // Relative URLs so the build works under a subpath and from file://.
  base: "./",
  plugins: [solid(), viteSingleFile()],
});
