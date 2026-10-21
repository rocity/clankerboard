import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "./harness";

function builtWebApp() {
  const dir = mkdtempSync(join(tmpdir(), "cb-web-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>Clankerboard</title>");
  writeFileSync(join(dir, "assets", "app.js"), "console.log('shell')");
  return dir;
}

describe("web shell", () => {
  it("serves the built web app from the same server", async () => {
    const { request } = buildTestApp({ config: { webDistDir: builtWebApp() } });

    const index = await request("/");
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("<title>Clankerboard</title>");

    const asset = await request("/assets/app.js");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("console.log('shell')");
  });

  it("falls back to the shell for client-side routes", async () => {
    const { request } = buildTestApp({ config: { webDistDir: builtWebApp() } });

    const res = await request("/invite/abc");

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>Clankerboard</title>");
  });

  it("answers unknown API paths with a JSON not-found", async () => {
    const { request } = buildTestApp({ config: { webDistDir: builtWebApp() } });

    const res = await request("/api/nothing-here");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found." });
  });
});
