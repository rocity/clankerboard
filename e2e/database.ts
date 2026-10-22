import pg from "pg";
import { e2eDatabaseName } from "./config.mjs";

const adminUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://agentkanban:agentkanban@localhost:55432/postgres";

export const e2eDatabaseUrl = (() => {
  const url = new URL(adminUrl);
  url.pathname = `/${e2eDatabaseName}`;
  return url.toString();
})();

/** Moves every Invite's expiry into the past, since the e2e server runs on the real clock. */
export async function expireInvites() {
  const client = new pg.Client({ connectionString: e2eDatabaseUrl });
  await client.connect();
  try {
    await client.query("update invites set expires_at = now() - interval '1 day'");
  } finally {
    await client.end();
  }
}

/** Empties every table so each test starts on a fresh instance. */
export async function resetDatabase() {
  const client = new pg.Client({ connectionString: e2eDatabaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    if (rows.length > 0) {
      const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
      // The previous test's page may still have a stream or request finishing on the
      // server, which can deadlock with the truncate. Postgres picks one side, so retry.
      for (let attempt = 1; ; attempt++) {
        try {
          await client.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
          break;
        } catch (error) {
          if ((error as { code?: string }).code !== "40P01" || attempt === 5) throw error;
        }
      }
    }
  } finally {
    await client.end();
  }
}
