import { build } from "esbuild";

// One self-contained file, so the runtime image needs no node_modules.
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external: ["pg-native"],
  banner: {
    js: "import { createRequire as __cbCreateRequire } from 'node:module'; const require = __cbCreateRequire(import.meta.url);",
  },
  logLevel: "info",
});
