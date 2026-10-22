import { updateTicket } from "@agentkanban/domain";
import { updateTicketInput } from "@agentkanban/shared";
import { z } from "zod";
import { ticketMarkdown } from "../markdown";
import { ticketKeyParam } from "../params";
import { defineTool } from "../tool";
import { mcpTicketView, ticketWithEmails } from "../views";

const { shape } = updateTicketInput;

export const updateTicketTool = defineTool({
  name: "update_ticket",
  description:
    "Change a ticket's title, description, priority, or parent, by its ticket key. Fields you leave out stay as they are.",
  // The spec gives Agents no way to change a Ticket's type.
  input: updateTicketInput.omit({ type: true }).extend({
    key: ticketKeyParam,
    title: shape.title.describe("A short summary."),
    description: shape.description.describe("Markdown. Replaces the whole description."),
    priority: shape.priority.describe("low, medium, high, or urgent."),
    parentKey: shape.parentKey.describe(
      "The parent's ticket key, such as CB-7, or null to clear it.",
    ),
  }),
  output: z.object({ ticket: mcpTicketView }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  async run({ key, ...input }, env) {
    const updated = await updateTicket(env.deps, env.ctx, key, input);
    const ticket = await ticketWithEmails(env, updated);
    return { data: { ticket }, markdown: ticketMarkdown(ticket) };
  },
});
