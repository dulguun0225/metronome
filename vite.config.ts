import { build, defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";
import { viteSingleFile } from "vite-plugin-singlefile";

const WORKLET_SUFFIX = "?worklet";

// Importing a module with the "?worklet" suffix gives its code, bundled with its imports into one
// script, as the default export string. The page loads it into an AudioWorklet from a data: URL, so the
// build stays a single file and needs no other request.
export function workletCode(): Plugin {
  let minify = false;
  return {
    name: "worklet-code",
    enforce: "pre",
    configResolved(config) {
      minify = config.command === "build";
    },
    async resolveId(source, importer) {
      if (!source.endsWith(WORKLET_SUFFIX)) return null;
      const resolved = await this.resolve(source.slice(0, -WORKLET_SUFFIX.length), importer, { skipSelf: true });
      return resolved && resolved.id + WORKLET_SUFFIX;
    },
    async load(id) {
      if (!id.endsWith(WORKLET_SUFFIX)) return null;
      const entry = id.slice(0, -WORKLET_SUFFIX.length);
      const result = await build({
        configFile: false,
        envDir: false,
        logLevel: "warn",
        build: {
          write: false,
          copyPublicDir: false,
          minify,
          lib: { entry, formats: ["es"], fileName: "worklet" },
        },
      });
      const outputs = Array.isArray(result) ? result : [result];
      const chunk = outputs.flatMap((o) => ("output" in o ? o.output : [])).find((o) => o.type === "chunk");
      if (!chunk || chunk.type !== "chunk") throw new Error(`no worklet code built from ${entry}`);
      for (const file of chunk.moduleIds) this.addWatchFile(file);
      return `export default ${JSON.stringify(chunk.code)};`;
    },
  };
}

export default defineConfig({
  // Relative URLs so the build works under a subpath and from file://.
  base: "./",
  plugins: [workletCode(), solid(), viteSingleFile()],
});
