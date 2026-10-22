import { getTicket, listChildren, listComments, listLinks } from "@agentkanban/domain";
import { z } from "zod";
import {
  bulletList,
  commentsMarkdown,
  linksMarkdown,
  ticketLine,
  ticketMarkdown,
} from "../markdown";
import { ticketKeyParam } from "../params";
import { defineTool } from "../tool";
import {
  type McpTicketView,
  mcpCommentView,
  mcpTicketLinkView,
  mcpTicketView,
  summarize,
  ticketSummary,
  withEmails,
} from "../views";

export const getTicketTool = defineTool({
  name: "get_ticket",
  description:
    "Get one ticket by its ticket key, such as CB-42: its fields, description, parent, children, the tickets it is blocked by, blocks, or relates to, and comments. Read it before starting work.",
  input: z.object({ key: ticketKeyParam }),
  output: z.object({
    ticket: mcpTicketView,
    children: z.array(ticketSummary),
    links: z.array(mcpTicketLinkView).describe("Blocked by, then blocks, then relates to."),
    comments: z.array(mcpCommentView),
  }),
  annotations: { readOnlyHint: true },
  async run({ key }, env) {
    const { deps, ctx } = env;
    // The first read is the not-found check for the others.
    const found = await getTicket(deps, ctx, key);
    const [children, links, comments] = await Promise.all([
      listChildren(deps, ctx, key),
      listLinks(deps, ctx, key),
      listComments(deps, ctx, key),
    ]);
    const views = await withEmails(env, { tickets: [found, ...children], comments, links });
    const ticket = views.tickets[0] as McpTicketView;
    const summaries = views.tickets.slice(1).map(summarize);
    const markdown = [
      ticketMarkdown(ticket),
      bulletList(
        "Children",
        summaries.map((child) => ticketLine(child)),
        "No children.",
      ),
      linksMarkdown(views.links),
      commentsMarkdown(views.comments),
    ].join("\n\n");
    return {
      data: { ticket, children: summaries, links: views.links, comments: views.comments },
      markdown,
    };
  },
});
