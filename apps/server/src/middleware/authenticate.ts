import {
  authenticateApiKey,
  type DomainDeps,
  resolveCompanyContext,
  type UserContext,
  unauthorized,
} from "@clankerboard/domain";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { Auth } from "../auth";
import type { AppEnv } from "../env";

/**
 * The one auth layer: a bearer API Key acts as its Agent, otherwise a session
 * cookie acts as its User. A request with an Authorization header never falls
 * back to the cookie.
 */
export function authenticate(auth: Auth, deps: DomainDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.set("user", null);
    c.set("sessionUser", null);
    c.set("activeCompanyId", null);
    c.set("agent", null);

    const authorization = c.req.header("authorization");
    if (authorization !== undefined) {
      const secret = /^Bearer\s+(\S+)$/i.exec(authorization.trim())?.[1];
      if (!secret) throw unauthorized("That API key is not valid.");
      c.set("agent", await authenticateApiKey(deps, secret));
      return next();
    }

    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (result) {
      c.set("user", result.user);
      c.set("sessionUser", {
        userId: result.user.id,
        email: result.user.email,
        sessionId: result.session.id,
      });
      c.set("activeCompanyId", result.session.activeOrganizationId ?? null);
    }
    await next();
  });
}

/** For routes only a signed-in human may use, such as creating a Company. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.agent) return c.json({ error: "Agents can't do this." }, 403);
  if (!c.var.sessionUser) return c.json({ error: "Sign in first." }, 401);
  await next();
});

/** Resolves the acting User or Agent in its Company. Use on every Company-scoped route. */
export function requireCompany(deps: Pick<DomainDeps, "db">) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (c.var.agent) {
      c.set("company", c.var.agent.ctx);
      return next();
    }
    if (!c.var.sessionUser) return c.json({ error: "Sign in first." }, 401);
    const company = await resolveCompanyContext(deps.db, c.var.sessionUser, c.var.activeCompanyId);
    if (!company) return c.json({ error: "Pick a company first." }, 400);
    c.set("company", company);
    await next();
  });
}

/** The signed-in User on a route behind requireUser. */
export function signedIn(c: Context<AppEnv>): UserContext {
  if (!c.var.sessionUser) throw unauthorized("Sign in first.");
  return c.var.sessionUser;
}
