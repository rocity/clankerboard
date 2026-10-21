import {
  createTicket,
  type DomainDeps,
  getTicket,
  listChildren,
  listTicketActivity,
  updateTicket,
} from "@clankerboard/domain";
import { createTicketInput, updateTicketInput } from "@clankerboard/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireCompany } from "../middleware/authenticate";
import { json } from "../validate";

export function ticketRoutes(deps: DomainDeps) {
  return new Hono<AppEnv>()
    .use("/tickets", requireCompany(deps))
    .use("/tickets/*", requireCompany(deps))
    .post("/tickets", json(createTicketInput), async (c) => {
      return c.json({ ticket: await createTicket(deps, c.var.company, c.req.valid("json")) }, 201);
    })
    .get("/tickets/:key", async (c) => {
      return c.json({ ticket: await getTicket(deps, c.var.company, c.req.param("key")) });
    })
    .patch("/tickets/:key", json(updateTicketInput), async (c) => {
      const ticket = await updateTicket(
        deps,
        c.var.company,
        c.req.param("key"),
        c.req.valid("json"),
      );
      return c.json({ ticket });
    })
    .get("/tickets/:key/children", async (c) => {
      return c.json({ children: await listChildren(deps, c.var.company, c.req.param("key")) });
    })
    .get("/tickets/:key/activity", async (c) => {
      return c.json({
        activity: await listTicketActivity(deps, c.var.company, c.req.param("key")),
      });
    });
}
