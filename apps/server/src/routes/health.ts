import type { Db } from "@agentkanban/db";
import { sql } from "drizzle-orm";
import { Hono } from "hono";

export function healthRoutes(db: Db) {
  return new Hono().get("/healthz", async (c) => {
    try {
      await db.execute(sql`select 1`);
      return c.json({ status: "ok", database: "ok" });
    } catch {
      return c.json({ status: "error", database: "unreachable" }, 503);
    }
  });
}
