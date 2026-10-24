import { moveTicket } from "@agentkanban/domain";
import { ticketStatus } from "@agentkanban/shared";
import { z } from "zod";
import { ticketLine } from "../markdown";
import { ticketKeyParam } from "../params";
import { defineTool } from "../tool";
import { summarize, ticketSummary, ticketWithEmails } from "../views";

export const moveTicketTool = defineTool({
  name: "move_ticket",
  description:
    "Move a ticket to a status, by its ticket key. It goes to the bottom of that status. Move your ticket to review when your work is ready. Returns the ticket's summary; use get_ticket for its description.",
  input: z.object({
    key: ticketKeyParam,
    status: ticketStatus.describe("backlog, todo, in_progress, review, or done."),
  }),
  // A summary, not the whole Ticket, so confirming a Status doesn't resend the description.
  output: z.object({ ticket: ticketSummary }),
  annotations: { readOnlyHint: false, destructiveHint: false },
  async run({ key, status }, env) {
    // No place given, so the domain puts it at the bottom.
    const moved = await moveTicket(env.deps, env.ctx, key, { status });
    const ticket = summarize(await ticketWithEmails(env, moved));
    return { data: { ticket }, markdown: `Moved ${ticketLine(ticket)}` };
  },
});
