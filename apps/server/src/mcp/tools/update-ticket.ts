import { updateTicket } from "@clankerboard/domain";
import { ticketKey, ticketView, updateTicketInput } from "@clankerboard/shared";
import { z } from "zod";
import { ticketMarkdown } from "../markdown";
import { defineTool } from "../tool";

const { shape } = updateTicketInput;

export const updateTicketTool = defineTool({
  name: "update_ticket",
  description:
    "Change a ticket's title, description, priority, or parent, by its ticket key. Fields you leave out stay as they are.",
  // The spec gives Agents no way to change a Ticket's type.
  input: updateTicketInput.omit({ type: true }).extend({
    key: ticketKey.describe("The ticket key, such as CB-42."),
    title: shape.title.describe("A short summary."),
    description: shape.description.describe("Markdown. Replaces the whole description."),
    priority: shape.priority.describe("low, medium, high, or urgent."),
    parentKey: shape.parentKey.describe(
      "The parent's ticket key, such as CB-7, or null to clear it.",
    ),
  }),
  output: z.object({ ticket: ticketView }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  async run({ key, ...input }, { deps, ctx }) {
    const ticket = await updateTicket(deps, ctx, key, input);
    return { data: { ticket }, markdown: ticketMarkdown(ticket) };
  },
});
