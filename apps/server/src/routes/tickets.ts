import {
  addComment,
  archiveTicket,
  assignTicket,
  claimTicket,
  createTicket,
  type DomainDeps,
  deleteTicket,
  getTicket,
  getTimeline,
  linkTickets,
  listChildren,
  listComments,
  listLinks,
  listTickets,
  moveTicket,
  restoreTicket,
  unlinkTickets,
  updateTicket,
} from "@agentkanban/domain";
import {
  addCommentInput,
  assignTicketInput,
  createTicketInput,
  linkTicketsInput,
  listChildrenQuery,
  listTicketsQuery,
  moveTicketInput,
  updateTicketInput,
} from "@agentkanban/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireCompany } from "../middleware/authenticate";
import { json, query } from "../validate";

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
    .get("/tickets/:key/timeline", async (c) => {
      return c.json({ timeline: await getTimeline(deps, c.var.company, c.req.param("key")) });
    })
    .get("/tickets/:key/children", query(listChildrenQuery), async (c) => {
      const children = await listChildren(deps, c.var.company, c.req.param("key"), {
        includeArchived: c.req.valid("query").archived === "include",
      });
      return c.json({ children });
    })
    .get("/tickets/:key/links", async (c) => {
      return c.json({ links: await listLinks(deps, c.var.company, c.req.param("key")) });
    })
    .post("/tickets/:key/links", json(linkTicketsInput), async (c) => {
      const link = await linkTickets(deps, c.var.company, c.req.param("key"), c.req.valid("json"));
      return c.json({ link }, 201);
    })
    .delete("/tickets/:key/links/:targetKey", async (c) => {
      await unlinkTickets(deps, c.var.company, c.req.param("key"), c.req.param("targetKey"));
      return c.body(null, 204);
    });
}
