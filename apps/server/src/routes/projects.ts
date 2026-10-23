import {
  createProject,
  createSprint,
  type DomainDeps,
  deleteProject,
  deleteSprint,
  finishSprint,
  getProject,
  listProjects,
  listSprints,
  startSprint,
  updateProject,
  updateSprint,
} from "@agentkanban/domain";
import {
  createProjectInput,
  createSprintInput,
  listProjectsQuery,
  startSprintInput,
  updateProjectInput,
  updateSprintInput,
} from "@agentkanban/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireCompany } from "../middleware/authenticate";
import { json, query } from "../validate";

export function projectRoutes(deps: DomainDeps) {
  return (
    new Hono<AppEnv>()
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
      })
      // A Project's Sprints, by number. They sit here so `/projects/*` checks the Company once.
      .get("/projects/:key/sprints", async (c) => {
        return c.json({ sprints: await listSprints(deps, c.var.company, c.req.param("key")) });
      })
      .post("/projects/:key/sprints", json(createSprintInput), async (c) => {
        const sprint = await createSprint(
          deps,
          c.var.company,
          c.req.param("key"),
          c.req.valid("json"),
        );
        return c.json({ sprint }, 201);
      })
      .patch("/projects/:key/sprints/:number", json(updateSprintInput), async (c) => {
        const { key, number } = c.req.param();
        const sprint = await updateSprint(
          deps,
          c.var.company,
          key,
          Number(number),
          c.req.valid("json"),
        );
        return c.json({ sprint });
      })
      .post("/projects/:key/sprints/:number/start", json(startSprintInput), async (c) => {
        const { key, number } = c.req.param();
        const sprint = await startSprint(
          deps,
          c.var.company,
          key,
          Number(number),
          c.req.valid("json"),
        );
        return c.json({ sprint });
      })
      .post("/projects/:key/sprints/:number/finish", async (c) => {
        const { key, number } = c.req.param();
        return c.json(await finishSprint(deps, c.var.company, key, Number(number)));
      })
      .delete("/projects/:key/sprints/:number", async (c) => {
        const { key, number } = c.req.param();
        await deleteSprint(deps, c.var.company, key, Number(number));
        return c.body(null, 204);
      })
  );
}
