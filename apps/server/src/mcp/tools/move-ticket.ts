import { moveTicket } from "@clankerboard/domain";
import { ticketKey, ticketStatus, ticketView } from "@clankerboard/shared";
import { z } from "zod";
import { ticketMarkdown } from "../markdown";
import { defineTool } from "../tool";

export const moveTicketTool = defineTool({
  name: "move_ticket",
  description:
    "Move a ticket to a status, by its ticket key. It goes to the bottom of that status. Move your ticket to review when your work is ready.",
  input: z.object({
    key: ticketKey.describe("The ticket key, such as CB-42."),
    status: ticketStatus.describe("backlog, todo, in_progress, review, or done."),
  }),
  output: z.object({ ticket: ticketView }),
  annotations: { readOnlyHint: false, destructiveHint: false },
  async run({ key, status }, { deps, ctx }) {
    // No place given, so the domain puts it at the bottom.
    const ticket = await moveTicket(deps, ctx, key, { status });
    return { data: { ticket }, markdown: ticketMarkdown(ticket) };
  },
});
