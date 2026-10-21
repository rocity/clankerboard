import pg from "pg";

// The compose `db-test` service. Override with TEST_DATABASE_URL to point elsewhere.
export const adminUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://clankerboard:clankerboard@localhost:55432/postgres";

export const templateDatabase = "cb_test_template";

export function databaseUrl(name: string) {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

export async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function recreateDatabase(client: pg.Client, name: string, template?: string) {
  await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${name}"${template ? ` TEMPLATE "${template}"` : ""}`);
}
