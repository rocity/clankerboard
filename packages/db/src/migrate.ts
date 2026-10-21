import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client";

export const defaultMigrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function runMigrations(db: Db, migrationsFolder = defaultMigrationsFolder) {
  await migrate(db, { migrationsFolder });
}
