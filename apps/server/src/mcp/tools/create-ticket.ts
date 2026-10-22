import { createTicket } from "@clankerboard/domain";
import { createTicketInput, ticketView } from "@clankerboard/shared";
import { z } from "zod";
import { ticketMarkdown } from "../markdown";
import { defineTool } from "../tool";

const { shape } = createTicketInput;

export const createTicketTool = defineTool({
  name: "create_ticket",
  description:
    "Create a ticket in a project. It starts in Backlog and you get back its ticket key, such as CB-42. An epic has no parent, a story or bug may sit under an epic, and a task under an epic or a story.",
  input: createTicketInput.extend({
    projectKey: shape.projectKey.describe("The project key, such as CB."),
    type: shape.type.describe("epic, story, task, or bug."),
    title: shape.title.describe("A short summary."),
    description: shape.description.describe("Markdown. Defaults to empty."),
    priority: shape.priority.describe("low, medium, high, or urgent. Defaults to medium."),
    parentKey: shape.parentKey.describe("The parent's ticket key, such as CB-7."),
  }),
  output: z.object({ ticket: ticketView }),
  annotations: { readOnlyHint: false, destructiveHint: false },
  async run(input, { deps, ctx }) {
    const ticket = await createTicket(deps, ctx, input);
    return { data: { ticket }, markdown: ticketMarkdown(ticket) };
  },
});
