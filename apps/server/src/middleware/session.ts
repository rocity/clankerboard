import { createMiddleware } from "hono/factory";
import type { Auth } from "../auth";
import type { AppEnv } from "../env";

export function loadSession(auth: Auth) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("user", result?.user ?? null);
    c.set("session", result?.session ?? null);
    await next();
  });
}

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) return c.json({ error: "Sign in first." }, 401);
  await next();
});
