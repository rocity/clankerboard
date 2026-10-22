import { assignTicket, findAssignee } from "@clankerboard/domain";
import { ticketKey, ticketView } from "@clankerboard/shared";
import { z } from "zod";
import { ticketMarkdown } from "../markdown";
import { defineTool } from "../tool";

const assigneeError = "Give a user's email, an agent's name, or null.";

export const assignTicketTool = defineTool({
  name: "assign_ticket",
  description:
    "Assign a ticket, by its ticket key such as CB-42, to a user by email or to an agent by name, or pass null to unassign it. Use it to hand work to a human for review. To start work on a ticket yourself, use claim_ticket.",
  input: z.object({
    key: ticketKey.describe("The ticket key, such as CB-42."),
    assignee: z
      .string({ error: assigneeError })
      .trim()
      .min(1, { error: assigneeError })
      .nullable()
      .describe("A user's email, an agent's name, or null to unassign."),
  }),
  output: z.object({ ticket: ticketView }),
  annotations: { readOnlyHint: false, idempotentHint: true },
  async run({ key, assignee }, { deps, ctx }) {
    const to = assignee === null ? null : await findAssignee(deps, ctx, assignee);
    const ticket = await assignTicket(deps, ctx, key, { assignee: to });
    return { data: { ticket }, markdown: ticketMarkdown(ticket) };
  },
});
