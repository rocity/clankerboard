import type { Db } from "@clankerboard/db";
import type { Clock, Mailer } from "@clankerboard/domain";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { createAuth } from "./auth";
import type { AppConfig } from "./config";
import type { AppEnv } from "./env";
import type { Logger } from "./logger";
import { requestLogger } from "./middleware/request-logger";
import { loadSession } from "./middleware/session";
import { healthRoutes } from "./routes/health";
import { meRoutes } from "./routes/me";
import { webRoutes } from "./routes/web";

export type { AppConfig };

export type AppDeps = {
  db: Db;
  clock: Clock;
  mailer: Mailer;
  config: AppConfig;
  logger: Logger;
};

export function createApp(deps: AppDeps) {
  const auth = createAuth(deps);

  const api = new Hono<AppEnv>().use(loadSession(auth)).route("/", meRoutes());

  const app = new Hono<AppEnv>()
    .use(requestId())
    .use(requestLogger(deps.logger))
    .route("/", healthRoutes(deps.db))
    .on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
    .route("/api", api);

  app.all("/api/*", (c) => c.json({ error: "Not found." }, 404));
  if (deps.config.webDistDir) app.route("/", webRoutes(deps.config.webDistDir));
  app.notFound((c) => c.json({ error: "Not found." }, 404));

  return app;
}
