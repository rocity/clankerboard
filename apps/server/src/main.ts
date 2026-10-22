import { createDatabase, ensureAuthSecret, runMigrations } from "@clankerboard/db";
import { noopMailer, systemClock } from "@clankerboard/domain";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { createSmtpMailer } from "./mailer";

const env = loadConfig(process.env);
const logger = createLogger(env.logLevel);
const database = createDatabase(env.databaseUrl);

// Migrations finish before the server accepts a single request.
await runMigrations(database.db, env.migrationsDir);
logger.info("migrations applied");

const authSecret = env.authSecret ?? (await ensureAuthSecret(database.db));
const shuttingDown = new AbortController();

const app = createApp({
  db: database.db,
  clock: systemClock,
  mailer: env.smtp ? createSmtpMailer(env.smtp, logger) : noopMailer,
  config: { ...env, authSecret },
  logger,
  shutdown: shuttingDown.signal,
});

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  logger.info({ port: info.port }, "listening");
});

function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    database.close().finally(() => process.exit(0));
  });
  // Live streams never end on their own, so close() would wait on them forever.
  shuttingDown.abort();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
