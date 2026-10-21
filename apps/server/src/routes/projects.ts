import {
  createProject,
  type DomainDeps,
  deleteProject,
  findProject,
  listProjects,
  updateProject,
} from "@clankerboard/domain";
import { createProjectInput, updateProjectInput } from "@clankerboard/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireCompany } from "../middleware/authenticate";
import { json } from "../validate";

export function projectRoutes(deps: DomainDeps) {
  return new Hono<AppEnv>()
    .use("/projects", requireCompany(deps))
    .use("/projects/*", requireCompany(deps))
    .get("/projects", async (c) => {
      const teamId = c.req.query("teamId");
      return c.json({ projects: await listProjects(deps, c.var.company, { teamId }) });
    })
    .post("/projects", json(createProjectInput), async (c) => {
      return c.json(
        { project: await createProject(deps, c.var.company, c.req.valid("json")) },
        201,
      );
    })
    .get("/projects/:key", async (c) => {
      return c.json({ project: await findProject(deps.db, c.var.company, c.req.param("key")) });
    })
    .patch("/projects/:key", json(updateProjectInput), async (c) => {
      const project = await updateProject(
        deps,
        c.var.company,
        c.req.param("key"),
        c.req.valid("json"),
      );
      return c.json({ project });
    })
    .delete("/projects/:key", async (c) => {
      await deleteProject(deps, c.var.company, c.req.param("key"));
      return c.body(null, 204);
    });
}
