import { createDatabase, runMigrations } from "@clankerboard/db";
import { adminUrl, databaseUrl, recreateDatabase, templateDatabase, withAdmin } from "./test-db";

// Migrate a template database once per run. Each test file then gets its own
// copy of it, so files can run in parallel without sharing state.
export default async function setup() {
  try {
    await withAdmin((client) => recreateDatabase(client, templateDatabase));
  } catch (error) {
    const { host } = new URL(adminUrl);
    const reason = error instanceof Error ? error.message : String(error);
    const hint = new Error(
      `Test database unreachable at ${host} (${reason || "connection refused"}). Run \`pnpm db:test:up\` first.`,
    );
    // Vitest crashes mapping a global-setup stack trace; the message is all that matters.
    hint.stack = hint.message;
    throw hint;
  }
  const { db, close } = createDatabase(databaseUrl(templateDatabase));
  try {
    await runMigrations(db);
  } finally {
    await close();
  }
}
