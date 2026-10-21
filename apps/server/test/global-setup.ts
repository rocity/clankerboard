import { createDatabase, runMigrations } from "@clankerboard/db";
import { databaseUrl, recreateDatabase, templateDatabase, withAdmin } from "./test-db";

// Migrate a template database once per run. Each test file then gets its own
// copy of it, so files can run in parallel without sharing state.
export default async function setup() {
  await withAdmin((client) => recreateDatabase(client, templateDatabase));
  const { db, close } = createDatabase(databaseUrl(templateDatabase));
  try {
    await runMigrations(db);
  } finally {
    await close();
  }
}
