import { claimTicket } from "@agentkanban/domain";
import { z } from "zod";
import { ticketMarkdown } from "../markdown";
import { ticketKeyParam } from "../params";
import { defineTool } from "../tool";
import { mcpTicketView, ticketWithEmails } from "../views";

export const claimTicketTool = defineTool({
  name: "claim_ticket",
  description:
    "Claim an unassigned ticket by its ticket key, such as CB-42, before you start work on it. You become its assignee and it moves to In Progress. If someone already holds it, the claim fails and names them: pick another ticket. When your work is ready, report it with add_comment.",
  input: z.object({ key: ticketKeyParam }),
  output: z.object({ ticket: mcpTicketView }),
  annotations: { readOnlyHint: false, idempotentHint: false },
  async run({ key }, env) {
    const ticket = await ticketWithEmails(env, await claimTicket(env.deps, env.ctx, key));
    return { data: { ticket }, markdown: ticketMarkdown(ticket) };
  },
});
