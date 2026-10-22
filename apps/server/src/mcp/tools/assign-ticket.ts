import { assignTicket, findAssignee } from "@agentkanban/domain";
import { z } from "zod";
import { ticketMarkdown } from "../markdown";
import { ticketKeyParam } from "../params";
import { defineTool } from "../tool";
import { mcpTicketView, ticketWithEmails } from "../views";

const assigneeError = "Give a user's email, an agent's name, or null.";

export const assignTicketTool = defineTool({
  name: "assign_ticket",
  description:
    "Assign a ticket, by its ticket key such as CB-42, to a user's email or an agent's name as tool output shows them, or pass null to unassign it. Use it to hand work to a human for review. To start work on a ticket yourself, use claim_ticket.",
  input: z.object({
    key: ticketKeyParam,
    assignee: z
      .string({ error: assigneeError })
      .trim()
      .min(1, { error: assigneeError })
      .nullable()
      .describe("A user's email, an agent's name, or null to unassign."),
  }),
  output: z.object({ ticket: mcpTicketView }),
  annotations: { readOnlyHint: false, idempotentHint: true },
  async run({ key, assignee }, env) {
    const { deps, ctx } = env;
    const to = assignee === null ? null : await findAssignee(deps, ctx, assignee);
    const ticket = await ticketWithEmails(
      env,
      await assignTicket(deps, ctx, key, { assignee: to }),
    );
    return { data: { ticket }, markdown: ticketMarkdown(ticket) };
  },
});
