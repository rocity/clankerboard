import type { Db } from "@clankerboard/db";
import type { Clock, DomainDeps, DomainHooks, Mailer } from "@clankerboard/domain";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { createAuth } from "./auth";
import type { AppConfig } from "./config";
import type { AppEnv } from "./env";
import { handleError } from "./errors";
import type { Logger } from "./logger";
import { requestLogger } from "./middleware/request-logger";
import { loadSession } from "./middleware/session";
import { authProviderRoutes } from "./routes/auth-providers";
import { companyRoutes } from "./routes/companies";
import { healthRoutes } from "./routes/health";
import { meRoutes } from "./routes/me";
import { memberRoutes } from "./routes/members";
import { webRoutes } from "./routes/web";

export type { AppConfig };

export type AppDeps = {
  db: Db;
  clock: Clock;
  mailer: Mailer;
  config: AppConfig;
  logger: Logger;
  /** Domain extension points, such as revoking Agents when a member is removed. */
  hooks?: Partial<DomainHooks>;
};

export function createApp(deps: AppDeps) {
  const auth = createAuth(deps);
  const domain: DomainDeps = {
    db: deps.db,
    clock: deps.clock,
    mailer: deps.mailer,
    hooks: { memberRemoved: [], ...deps.hooks },
  };

  const api = new Hono<AppEnv>()
    .route("/", authProviderRoutes(deps.config))
    .use(loadSession(auth))
    .route("/", meRoutes())
    .route("/", companyRoutes(domain))
    .route("/", memberRoutes(domain));

  const app = new Hono<AppEnv>()
    .use(requestId())
    .use(requestLogger(deps.logger))
    .route("/", healthRoutes(deps.db))
    // Better Auth's organization endpoints would bypass the domain's tenancy
    // rules, so they are never exposed.
    .all("/api/auth/organization/*", (c) => c.json({ error: "Not found." }, 404))
    .on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
    .route("/api", api);

  app.all("/api/*", (c) => c.json({ error: "Not found." }, 404));
  if (deps.config.webDistDir) app.route("/", webRoutes(deps.config.webDistDir));
  app.notFound((c) => c.json({ error: "Not found." }, 404));
  app.onError(handleError);

  return app;
}
