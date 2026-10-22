import { getTicket, listChildren, listComments } from "@clankerboard/domain";
import { commentView, ticketKey, ticketView } from "@clankerboard/shared";
import { z } from "zod";
import { bulletList, commentsMarkdown, ticketLine, ticketMarkdown } from "../markdown";
import { defineTool } from "../tool";

const childSummary = ticketView.pick({
  key: true,
  title: true,
  type: true,
  status: true,
  priority: true,
  assignee: true,
});

export const getTicketTool = defineTool({
  name: "get_ticket",
  description:
    "Get one ticket by its ticket key, such as CB-42: its fields, description, parent, children, and comments. Read it before starting work.",
  input: z.object({ key: ticketKey.describe("The ticket key, such as CB-42.") }),
  output: z.object({
    ticket: ticketView,
    children: z.array(childSummary),
    comments: z.array(commentView),
  }),
  annotations: { readOnlyHint: true },
  async run({ key }, { deps, ctx }) {
    // The first read is the not-found check for the other two.
    const ticket = await getTicket(deps, ctx, key);
    const [children, comments] = await Promise.all([
      listChildren(deps, ctx, key),
      listComments(deps, ctx, key),
    ]);
    const summaries = children.map(({ key, title, type, status, priority, assignee }) => ({
      key,
      title,
      type,
      status,
      priority,
      assignee,
    }));
    const markdown = [
      ticketMarkdown(ticket),
      bulletList("Children", summaries.map(ticketLine), "No children."),
      commentsMarkdown(comments),
    ].join("\n\n");
    return { data: { ticket, children: summaries, comments }, markdown };
  },
});
