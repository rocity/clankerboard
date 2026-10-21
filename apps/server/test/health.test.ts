import { createDatabase } from "@clankerboard/db";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "./harness";

describe("GET /healthz", () => {
  it("reports ready when the database is reachable", async () => {
    const { request } = buildTestApp();

    const res = await request("/healthz");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: "ok" });
  });

  it("reports unhealthy when the database is unreachable", async () => {
    const unreachable = createDatabase("postgres://nobody:nothing@127.0.0.1:1/none");
    const { request } = buildTestApp({ deps: { db: unreachable.db } });

    const res = await request("/healthz");

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error", database: "unreachable" });
    await unreachable.close();
  });
});
