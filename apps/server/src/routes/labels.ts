import { type DomainDeps, deleteLabel, listLabels, updateLabel } from "@agentkanban/domain";
import { updateLabelInput } from "@agentkanban/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireCompany } from "../middleware/authenticate";
import { json } from "../validate";

// No create route: a Label is created by being applied to a Ticket.
export function labelRoutes(deps: DomainDeps) {
  return new Hono<AppEnv>()
    .use("/labels", requireCompany(deps))
    .use("/labels/*", requireCompany(deps))
    .get("/labels", async (c) => {
      return c.json({ labels: await listLabels(deps, c.var.company) });
    })
    .patch("/labels/:id", json(updateLabelInput), async (c) => {
      const label = await updateLabel(deps, c.var.company, c.req.param("id"), c.req.valid("json"));
      return c.json({ label });
    })
    .delete("/labels/:id", async (c) => {
      await deleteLabel(deps, c.var.company, c.req.param("id"));
      return c.body(null, 204);
    });
}
