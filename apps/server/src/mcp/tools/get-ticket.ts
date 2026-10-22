import { getTicket, listChildren, listComments } from "@agentkanban/domain";
import { z } from "zod";
import { bulletList, commentsMarkdown, ticketLine, ticketMarkdown } from "../markdown";
import { ticketKeyParam } from "../params";
import { defineTool } from "../tool";
import {
  type McpTicketView,
  mcpCommentView,
  mcpTicketView,
  summarize,
  ticketSummary,
  withEmails,
} from "../views";

export const getTicketTool = defineTool({
  name: "get_ticket",
  description:
    "Get one ticket by its ticket key, such as CB-42: its fields, description, parent, children, and comments. Read it before starting work.",
  input: z.object({ key: ticketKeyParam }),
  output: z.object({
    ticket: mcpTicketView,
    children: z.array(ticketSummary),
    comments: z.array(mcpCommentView),
  }),
  annotations: { readOnlyHint: true },
  async run({ key }, env) {
    const { deps, ctx } = env;
    // The first read is the not-found check for the other two.
    const found = await getTicket(deps, ctx, key);
    const [children, comments] = await Promise.all([
      listChildren(deps, ctx, key),
      listComments(deps, ctx, key),
    ]);
    const views = await withEmails(env, { tickets: [found, ...children], comments });
    const ticket = views.tickets[0] as McpTicketView;
    const summaries = views.tickets.slice(1).map(summarize);
    const markdown = [
      ticketMarkdown(ticket),
      bulletList(
        "Children",
        summaries.map((child) => ticketLine(child)),
        "No children.",
      ),
      commentsMarkdown(views.comments),
    ].join("\n\n");
    return { data: { ticket, children: summaries, comments: views.comments }, markdown };
  },
});
