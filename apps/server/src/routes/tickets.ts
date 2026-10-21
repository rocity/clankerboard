import {
  addComment,
  archiveTicket,
  assignTicket,
  claimTicket,
  createTicket,
  type DomainDeps,
  deleteTicket,
  getHistory,
  getTicket,
  listChildren,
  listComments,
  listTicketActivity,
  listTickets,
  moveTicket,
  restoreTicket,
  updateTicket,
} from "@clankerboard/domain";
import {
  addCommentInput,
  assignTicketInput,
  createTicketInput,
  listTicketsQuery,
  moveTicketInput,
  updateTicketInput,
} from "@clankerboard/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireCompany } from "../middleware/authenticate";
import { json, query } from "../validate";

const childrenQuery = z.object({
  archived: z.enum(["exclude", "include"], { error: "Use archived=include." }).default("exclude"),
});

export function ticketRoutes(deps: DomainDeps) {
  return new Hono<AppEnv>()
    .use("/tickets", requireCompany(deps))
    .use("/tickets/*", requireCompany(deps))
    .get("/tickets", query(listTicketsQuery), async (c) => {
      return c.json(await listTickets(deps, c.var.company, c.req.valid("query")));
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
    .delete("/tickets/:key", async (c) => {
      await deleteTicket(deps, c.var.company, c.req.param("key"));
      return c.body(null, 204);
    })
    .post("/tickets/:key/archive", async (c) => {
      return c.json({ ticket: await archiveTicket(deps, c.var.company, c.req.param("key")) });
    })
    .post("/tickets/:key/restore", async (c) => {
      return c.json({ ticket: await restoreTicket(deps, c.var.company, c.req.param("key")) });
    })
    .post("/tickets/:key/claim", async (c) => {
      return c.json({ ticket: await claimTicket(deps, c.var.company, c.req.param("key")) });
    })
    .get("/tickets/:key/comments", async (c) => {
      return c.json({ comments: await listComments(deps, c.var.company, c.req.param("key")) });
    })
    .post("/tickets/:key/comments", json(addCommentInput), async (c) => {
      const comment = await addComment(
        deps,
        c.var.company,
        c.req.param("key"),
        c.req.valid("json"),
      );
      return c.json({ comment }, 201);
    })
    .get("/tickets/:key/history", async (c) => {
      return c.json({ history: await getHistory(deps, c.var.company, c.req.param("key")) });
    })
    .get("/tickets/:key/children", query(childrenQuery), async (c) => {
      const children = await listChildren(deps, c.var.company, c.req.param("key"), {
        includeArchived: c.req.valid("query").archived === "include",
      });
      return c.json({ children });
    })
    .get("/tickets/:key/activity", async (c) => {
      return c.json({
        activity: await listTicketActivity(deps, c.var.company, c.req.param("key")),
      });
    });
}
