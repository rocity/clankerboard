// Starts the built server against a fresh database on the compose `db-test` service.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { e2eDatabaseName, e2ePort } from "./config.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const adminUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://clankerboard:clankerboard@localhost:55432/postgres";
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${e2eDatabaseName}`;

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS "${e2eDatabaseName}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${e2eDatabaseName}"`);
await admin.end();

const server = spawn("node", ["apps/server/dist/main.js"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(e2ePort),
    DATABASE_URL: databaseUrl.toString(),
    BASE_URL: `http://localhost:${e2ePort}`,
    WEB_DIST_DIR: `${root}apps/web/dist`,
    MIGRATIONS_DIR: `${root}packages/db/drizzle`,
    LOG_LEVEL: "warn",
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
