import { changeMemberRole, type DomainDeps, listMembers, removeMember } from "@clankerboard/domain";
import { changeRoleInput } from "@clankerboard/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireCompany } from "../middleware/session";
import { json } from "../validate";

export function memberRoutes(deps: DomainDeps) {
  return new Hono<AppEnv>()
    .use("/members", requireCompany(deps.db))
    .use("/members/*", requireCompany(deps.db))
    .get("/members", async (c) => {
      return c.json({ members: await listMembers(deps, c.var.company) });
    })
    .patch("/members/:userId", json(changeRoleInput), async (c) => {
      const member = await changeMemberRole(
        deps,
        c.var.company,
        c.req.param("userId"),
        c.req.valid("json").role,
      );
      return c.json({ member });
    })
    .delete("/members/:userId", async (c) => {
      await removeMember(deps, c.var.company, c.req.param("userId"));
      return c.body(null, 204);
    });
}
