import {
  addTeamMember,
  createTeam,
  type DomainDeps,
  deleteTeam,
  getTeam,
  listTeams,
  removeTeamMember,
  renameTeam,
  setTeamMemberRole,
} from "@clankerboard/domain";
import {
  addTeamMemberInput,
  createTeamInput,
  renameTeamInput,
  setTeamRoleInput,
} from "@clankerboard/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireCompany } from "../middleware/authenticate";
import { json } from "../validate";

export function teamRoutes(deps: DomainDeps) {
  return new Hono<AppEnv>()
    .use("/teams", requireCompany(deps))
    .use("/teams/*", requireCompany(deps))
    .get("/teams", async (c) => {
      return c.json({ teams: await listTeams(deps, c.var.company) });
    })
    .post("/teams", json(createTeamInput), async (c) => {
      return c.json({ team: await createTeam(deps, c.var.company, c.req.valid("json")) }, 201);
    })
    .get("/teams/:teamId", async (c) => {
      return c.json(await getTeam(deps, c.var.company, c.req.param("teamId")));
    })
    .patch("/teams/:teamId", json(renameTeamInput), async (c) => {
      const team = await renameTeam(
        deps,
        c.var.company,
        c.req.param("teamId"),
        c.req.valid("json"),
      );
      return c.json({ team });
    })
    .delete("/teams/:teamId", async (c) => {
      await deleteTeam(deps, c.var.company, c.req.param("teamId"));
      return c.body(null, 204);
    })
    .post("/teams/:teamId/members", json(addTeamMemberInput), async (c) => {
      const { userId } = c.req.valid("json");
      const member = await addTeamMember(deps, c.var.company, c.req.param("teamId"), userId);
      return c.json({ member }, 201);
    })
    .patch("/teams/:teamId/members/:userId", json(setTeamRoleInput), async (c) => {
      const member = await setTeamMemberRole(
        deps,
        c.var.company,
        c.req.param("teamId"),
        c.req.param("userId"),
        c.req.valid("json").role,
      );
      return c.json({ member });
    })
    .delete("/teams/:teamId/members/:userId", async (c) => {
      await removeTeamMember(deps, c.var.company, c.req.param("teamId"), c.req.param("userId"));
      return c.body(null, 204);
    });
}
