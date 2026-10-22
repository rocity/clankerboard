import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Ports come from the root .env.local (see .env.local.example), the same file `pnpm dev`
// gives the server, so this checkout can avoid ports other projects hold. Without one
// they fall back to the server's default and Vite's. Compose's .env is not read.
const envFile = fileURLToPath(new URL("../../.env.local", import.meta.url));
const local = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
const env = { ...local, ...process.env };

const api = `http://localhost:${env.PORT ?? 3000}`;

export default defineConfig({
  // The router plugin must come before the React plugin.
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: Number(env.WEB_PORT ?? 5173),
    // Fail rather than drift to another port, which Better Auth would reject as an origin.
    strictPort: true,
    proxy: { "/api": api, "/healthz": api },
  },
});
