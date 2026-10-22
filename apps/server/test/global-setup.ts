import { randomUUID } from "node:crypto";
import { createDatabase, runMigrations } from "@agentkanban/db";
import type { TestProject } from "vitest/node";
import { adminUrl, databaseUrl, recreateDatabase, withAdmin } from "./test-db";

// Migrate a template database once per run. Each test file then gets its own
// copy of it, so files can run in parallel without sharing state. The template
// is named per run, so runs from several worktrees can share one Postgres.
export default async function setup(project: TestProject) {
  const templateDatabase = `cb_test_template_${randomUUID().replaceAll("-", "")}`;
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
  project.provide("templateDatabase", templateDatabase);

  return async () => {
    await withAdmin((client) =>
      client.query(`DROP DATABASE IF EXISTS "${templateDatabase}" WITH (FORCE)`),
    );
  };
}
