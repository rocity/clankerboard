// Starts the built server against a fresh database on the compose `db-test` service.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = fileURLToPath(new URL("..", import.meta.url));
const adminUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://clankerboard:clankerboard@localhost:55432/postgres";
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = "/cb_e2e";

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query('DROP DATABASE IF EXISTS "cb_e2e" WITH (FORCE)');
await admin.query('CREATE DATABASE "cb_e2e"');
await admin.end();

const port = process.env.PORT ?? "3197";
const server = spawn("node", ["apps/server/dist/main.js"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl.toString(),
    BASE_URL: `http://localhost:${port}`,
    WEB_DIST_DIR: `${root}apps/web/dist`,
    MIGRATIONS_DIR: `${root}packages/db/drizzle`,
    LOG_LEVEL: "warn",
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
