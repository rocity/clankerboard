import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@clankerboard/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, inject } from "vitest";
import { databaseUrl, recreateDatabase, withAdmin } from "./test-db";

const name = `cb_test_${randomUUID().replaceAll("-", "")}`;
await withAdmin((client) => recreateDatabase(client, name, inject("templateDatabase")));

export const database: Database = createDatabase(databaseUrl(name));
(globalThis as { __cbTestDatabase?: Database }).__cbTestDatabase = database;

beforeEach(async () => {
  const { rows } = await database.db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
  await database.db.execute(sql.raw(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`));
});

afterAll(async () => {
  await database.close();
  await withAdmin((client) => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
});
