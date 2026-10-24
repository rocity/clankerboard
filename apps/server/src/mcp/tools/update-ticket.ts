import { updateTicket } from "@agentkanban/domain";
import { updateTicketInput } from "@agentkanban/shared";
import { z } from "zod";
import { ticketLine } from "../markdown";
import {
  estimateDescription,
  labelsDescription,
  progressDescription,
  sprintDescription,
  ticketKeyParam,
} from "../params";
import { defineTool } from "../tool";
import { summarize, ticketSummary, ticketWithEmails } from "../views";

const { shape } = updateTicketInput;

export const updateTicketTool = defineTool({
  name: "update_ticket",
  description:
    "Change a ticket's title, description, priority, parent, estimate, progress, labels, or sprint, by its ticket key. Fields you leave out stay as they are. While you work a ticket, update its progress so the humans watching the board see how far along it is. Returns the ticket's summary; use get_ticket for its description.",
  // The spec gives Agents no way to change a Ticket's type.
  input: updateTicketInput.omit({ type: true }).extend({
    key: ticketKeyParam,
    title: shape.title.describe("A short summary."),
    description: shape.description.describe("Markdown. Replaces the whole description."),
    priority: shape.priority.describe("low, medium, high, or urgent."),
    parentKey: shape.parentKey.describe(
      "The parent's ticket key, such as CB-7, or null to clear it.",
    ),
    estimate: shape.estimate.describe(estimateDescription),
    progress: shape.progress.describe(progressDescription),
    labels: shape.labels.describe(
      `Replaces the whole set of labels: pass the current labels plus any to add, or [] to remove them all. ${labelsDescription}`,
    ),
    sprint: shape.sprint.describe(sprintDescription),
  }),
  // A summary, not the whole Ticket, so confirming a field doesn't resend the description.
  output: z.object({ ticket: ticketSummary }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  async run({ key, ...input }, env) {
    const updated = await updateTicket(env.deps, env.ctx, key, input);
    const ticket = summarize(await ticketWithEmails(env, updated));
    return { data: { ticket }, markdown: `Updated ${ticketLine(ticket)}` };
  },
});
