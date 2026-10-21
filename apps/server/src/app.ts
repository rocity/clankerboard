import type { Db } from "@clankerboard/db";
import {
  type Clock,
  type DomainDeps,
  type DomainHooks,
  type EventBus,
  type Mailer,
  noopEventBus,
  noopMailer,
  revokeAgentsOfRemovedMember,
} from "@clankerboard/domain";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { createAuth } from "./auth";
import type { AppConfig } from "./config";
import type { AppEnv } from "./env";
import { handleError } from "./errors";
import type { Logger } from "./logger";
import { authenticate } from "./middleware/authenticate";
import { requestLogger } from "./middleware/request-logger";
import { RateLimiter } from "./rate-limit";
import { agentRoutes } from "./routes/agents";
import { authProviderRoutes } from "./routes/auth-providers";
import { companyRoutes } from "./routes/companies";
import { healthRoutes } from "./routes/health";
import { inviteRoutes } from "./routes/invites";
import { meRoutes } from "./routes/me";
import { memberRoutes } from "./routes/members";
import { projectRoutes } from "./routes/projects";
import { teamRoutes } from "./routes/teams";
import { ticketRoutes } from "./routes/tickets";
import { webRoutes } from "./routes/web";

export type { AppConfig };

export type AppDeps = {
  db: Db;
  clock: Clock;
  mailer: Mailer;
  config: AppConfig;
  logger: Logger;
  /** Receives every Activity after commit. Defaults to one that drops it. */
  events?: EventBus;
  /** Extra domain hooks, run after the built-in ones (such as revoking a removed member's Agents). */
  hooks?: Partial<DomainHooks>;
};

export function createApp(deps: AppDeps) {
  const { config } = deps;
  const domain: DomainDeps = {
    db: deps.db,
    clock: deps.clock,
    // Email goes out only when the operator configured SMTP.
    mailer: config.smtp ? deps.mailer : noopMailer,
    config: {
      baseUrl: config.baseUrl,
      inviteTtlMs: config.inviteTtlMs,
      openSignup: config.openSignup,
    },
    events: deps.events ?? noopEventBus,
    hooks: {
      memberRemoved: [
        revokeAgentsOfRemovedMember(deps.clock),
        ...(deps.hooks?.memberRemoved ?? []),
      ],
    },
  };
  const auth = createAuth({ domain, config, logger: deps.logger });

  const api = new Hono<AppEnv>()
    .route("/", authProviderRoutes(deps.config))
    .use(authenticate(auth, domain, new RateLimiter(config.rateLimit, deps.clock)))
    .route("/", meRoutes())
    .route("/", companyRoutes(domain))
    .route("/", memberRoutes(domain))
    .route("/", inviteRoutes(domain))
    .route("/", teamRoutes(domain))
    .route("/", agentRoutes(domain))
    .route("/", projectRoutes(domain))
    .route("/", ticketRoutes(domain));

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
