import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;

export type Database = {
  db: Db;
  close: () => Promise<void>;
};

export function createDatabase(url: string): Database {
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
  // An idle client losing its connection must not crash the process; the next
  // query reports the failure instead.
  pool.on("error", () => {});
  const db = drizzle(pool, { schema, casing: "snake_case" });
  return { db, close: () => pool.end() };
}
