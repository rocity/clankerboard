import { claimTicket } from "@clankerboard/domain";
import { ticketKey, ticketView } from "@clankerboard/shared";
import { z } from "zod";
import { ticketMarkdown } from "../markdown";
import { defineTool } from "../tool";

export const claimTicketTool = defineTool({
  name: "claim_ticket",
  description:
    "Claim an unassigned ticket by its ticket key, such as CB-42, before you start work on it. You become its assignee and it moves to In Progress. If someone already holds it, the claim fails and names them: pick another ticket. When your work is ready, report it with add_comment.",
  input: z.object({ key: ticketKey.describe("The ticket key, such as CB-42.") }),
  output: z.object({ ticket: ticketView }),
  annotations: { readOnlyHint: false, idempotentHint: false },
  async run({ key }, { deps, ctx }) {
    const ticket = await claimTicket(deps, ctx, key);
    return { data: { ticket }, markdown: ticketMarkdown(ticket) };
  },
});
