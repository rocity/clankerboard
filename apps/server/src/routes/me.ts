import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireUser } from "../middleware/authenticate";

export function meRoutes() {
  return new Hono<AppEnv>().get("/me", requireUser, (c) => {
    const user = c.var.user;
    if (!user) throw new Error("unreachable");
    return c.json({
      user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
    });
  });
}
