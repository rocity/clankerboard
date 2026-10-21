import {
  assignTicket,
  claimTicket,
  createTicket,
  type DomainDeps,
  getTicket,
  listChildren,
  listTicketActivity,
  listTickets,
  moveTicket,
  updateTicket,
} from "@clankerboard/domain";
import {
  assignTicketInput,
  createTicketInput,
  moveTicketInput,
  ticketStatus,
  updateTicketInput,
} from "@clankerboard/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireCompany } from "../middleware/authenticate";
import { json, query } from "../validate";

const listQuery = z.object({
  projectKey: z.string().optional(),
  status: ticketStatus.optional(),
});

export function ticketRoutes(deps: DomainDeps) {
  return new Hono<AppEnv>()
    .use("/tickets", requireCompany(deps))
    .use("/tickets/*", requireCompany(deps))
    .get("/tickets", query(listQuery), async (c) => {
      return c.json({ tickets: await listTickets(deps, c.var.company, c.req.valid("query")) });
    })
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
    .post("/tickets/:key/move", json(moveTicketInput), async (c) => {
      const ticket = await moveTicket(deps, c.var.company, c.req.param("key"), c.req.valid("json"));
      return c.json({ ticket });
    })
    .post("/tickets/:key/assign", json(assignTicketInput), async (c) => {
      const ticket = await assignTicket(
        deps,
        c.var.company,
        c.req.param("key"),
        c.req.valid("json"),
      );
      return c.json({ ticket });
    })
    .post("/tickets/:key/claim", async (c) => {
      return c.json({ ticket: await claimTicket(deps, c.var.company, c.req.param("key")) });
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
