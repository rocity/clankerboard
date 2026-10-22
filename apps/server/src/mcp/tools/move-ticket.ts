import { moveTicket } from "@agentkanban/domain";
import { ticketStatus } from "@agentkanban/shared";
import { z } from "zod";
import { ticketMarkdown } from "../markdown";
import { ticketKeyParam } from "../params";
import { defineTool } from "../tool";
import { mcpTicketView, ticketWithEmails } from "../views";

export const moveTicketTool = defineTool({
  name: "move_ticket",
  description:
    "Move a ticket to a status, by its ticket key. It goes to the bottom of that status. Move your ticket to review when your work is ready.",
  input: z.object({
    key: ticketKeyParam,
    status: ticketStatus.describe("backlog, todo, in_progress, review, or done."),
  }),
  output: z.object({ ticket: mcpTicketView }),
  annotations: { readOnlyHint: false, destructiveHint: false },
  async run({ key, status }, env) {
    // No place given, so the domain puts it at the bottom.
    const moved = await moveTicket(env.deps, env.ctx, key, { status });
    const ticket = await ticketWithEmails(env, moved);
    return { data: { ticket }, markdown: ticketMarkdown(ticket) };
  },
});
