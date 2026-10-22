import { type DomainDeps, listActors } from "@clankerboard/domain";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireCompany } from "../middleware/authenticate";

export function actorRoutes(deps: DomainDeps) {
  return new Hono<AppEnv>().get("/actors", requireCompany(deps), async (c) => {
    return c.json({ actors: await listActors(deps, c.var.company) });
  });
}
