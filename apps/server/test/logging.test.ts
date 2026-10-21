import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger";
import { buildTestApp } from "./harness";

describe("request logging", () => {
  it("logs each request as JSON with a per-request id", async () => {
    const lines: string[] = [];
    const logger = createLogger("info", { write: (line: string) => lines.push(line) });
    const { request } = buildTestApp({ deps: { logger } });

    const first = await request("/healthz");
    const second = await request("/healthz");

    const entries = lines.map((line) => JSON.parse(line));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ method: "GET", path: "/healthz", status: 200 });
    expect(entries[0].requestId).toBe(first.headers.get("x-request-id"));
    expect(entries[1].requestId).toBe(second.headers.get("x-request-id"));
    expect(entries[0].requestId).not.toBe(entries[1].requestId);
  });
});
