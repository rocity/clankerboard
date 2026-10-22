import {
  createProject,
  type DomainDeps,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "@agentkanban/domain";
import { createProjectInput, listProjectsQuery, updateProjectInput } from "@agentkanban/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireCompany } from "../middleware/authenticate";
import { json, query } from "../validate";

export function projectRoutes(deps: DomainDeps) {
  return new Hono<AppEnv>()
    .use("/projects", requireCompany(deps))
    .use("/projects/*", requireCompany(deps))
    .get("/projects", query(listProjectsQuery), async (c) => {
      return c.json({ projects: await listProjects(deps, c.var.company, c.req.valid("query")) });
    })
    .post("/projects", json(createProjectInput), async (c) => {
      return c.json(
        { project: await createProject(deps, c.var.company, c.req.valid("json")) },
        201,
      );
    })
    .get("/projects/:key", async (c) => {
      return c.json({ project: await getProject(deps, c.var.company, c.req.param("key")) });
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
