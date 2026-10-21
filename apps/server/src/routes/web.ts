import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { AppEnv } from "../env";

// Serves the built SPA. Any GET that isn't a file falls back to index.html so
// client-side routes survive a reload.
export function webRoutes(webDistDir: string) {
  return new Hono<AppEnv>()
    .use("*", serveStatic({ root: webDistDir }))
    .get("*", serveStatic({ root: webDistDir, path: "index.html" }));
}
