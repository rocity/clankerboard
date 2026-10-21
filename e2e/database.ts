import pg from "pg";

const adminUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://clankerboard:clankerboard@localhost:55432/postgres";

export const e2eDatabaseUrl = (() => {
  const url = new URL(adminUrl);
  url.pathname = "/cb_e2e";
  return url.toString();
})();

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
      await client.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await client.end();
  }
}
