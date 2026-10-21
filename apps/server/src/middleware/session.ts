import { type Db, resolveCompanyContext } from "@clankerboard/domain";
import { createMiddleware } from "hono/factory";
import type { Auth } from "../auth";
import type { AppEnv } from "../env";

export function loadSession(auth: Auth) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("user", result?.user ?? null);
    c.set("session", result?.session ?? null);
    if (result) {
      c.set("actor", {
        userId: result.user.id,
        email: result.user.email,
        sessionId: result.session.id,
      });
    }
    await next();
  });
}

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) return c.json({ error: "Sign in first." }, 401);
  await next();
});

/** Resolves the acting User's active Company. Use on every Company-scoped route. */
export function requireCompany(db: Db) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!c.var.user || !c.var.session) return c.json({ error: "Sign in first." }, 401);
    const company = await resolveCompanyContext(
      db,
      c.var.actor,
      c.var.session.activeOrganizationId,
    );
    if (!company) return c.json({ error: "Pick a company first." }, 400);
    c.set("company", company);
    await next();
  });
}
