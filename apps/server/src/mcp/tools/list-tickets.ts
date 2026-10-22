import { listTickets, refOf } from "@clankerboard/domain";
import { assigneeFilter, listTicketsQuery, ticketPage, ticketView } from "@clankerboard/shared";
import { z } from "zod";
import { bulletList, ticketLine } from "../markdown";
import { defineTool } from "../tool";

const ticketSummary = ticketView.pick({
  key: true,
  title: true,
  type: true,
  status: true,
  priority: true,
  assignee: true,
  parent: true,
});

const limitError = { error: "Limits are whole numbers from 1 to 100." };

const input = listTicketsQuery
  .pick({ projectKey: true, status: true, type: true, priority: true, q: true, cursor: true })
  .extend({
    // "me" is the calling Agent, so it can find its own work without knowing its id.
    assignee: z
      .union([z.literal("me"), assigneeFilter])
      .optional()
      .describe(
        "Who the tickets are assigned to: me, unassigned, agents, users, user:<id>, or agent:<id>.",
      ),
    parentKey: listTicketsQuery.shape.parentKey.describe(
      "Only children of this ticket key, such as CB-42.",
    ),
    q: listTicketsQuery.shape.q.describe("Words to find in the title or description."),
    limit: z
      .number(limitError)
      .int(limitError)
      .min(1, limitError)
      .max(100, limitError)
      .default(20)
      .describe("How many tickets to return. Defaults to 20."),
    cursor: listTicketsQuery.shape.cursor.describe("nextCursor from the previous page."),
  });

export const listTicketsTool = defineTool({
  name: "list_tickets",
  description:
    "List tickets by ticket key, most urgent first within each status. Filter by project key, status, type, priority, assignee, parent ticket key, or text. With status todo and assignee unassigned, the first result is the next ticket to claim with claim_ticket. Archived tickets are left out. Pass nextCursor back as cursor for the next page.",
  input,
  output: z.object({
    tickets: z.array(ticketSummary),
    nextCursor: ticketPage.shape.nextCursor,
  }),
  annotations: { readOnlyHint: true },
  async run({ assignee, ...filter }, { deps, ctx }) {
    const page = await listTickets(
      deps,
      ctx,
      {
        ...filter,
        assignee: assignee === "me" ? { kind: "actor", actor: refOf(ctx.actor) } : assignee,
        archived: "exclude",
      },
      { order: "urgency" },
    );
    const tickets = page.tickets.map(
      ({ key, title, type, status, priority, assignee, parent }) => ({
        key,
        title,
        type,
        status,
        priority,
        assignee,
        parent,
      }),
    );
    let markdown = bulletList("Tickets", tickets.map(ticketLine), "No tickets match.");
    if (page.nextCursor) markdown += `\n\nMore tickets match. Next cursor: ${page.nextCursor}`;
    return { data: { tickets, nextCursor: page.nextCursor }, markdown };
  },
});
