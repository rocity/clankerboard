import { findAssignee, listTickets, refOf } from "@agentkanban/domain";
import {
  type AssigneeFilter,
  assigneeFilter,
  listTicketsQuery,
  type SprintFilter,
  sprintNumber,
  ticketPage,
} from "@agentkanban/shared";
import { z } from "zod";
import { bulletList, ticketLine } from "../markdown";
import { defineTool, type ToolEnv } from "../tool";
import { summarize, ticketSummary, withEmails } from "../views";

const limitError = { error: "Limits are whole numbers from 1 to 100." };
const assigneeError = "Give me, unassigned, agents, users, a user's email, or an agent's name.";
const sprintError = { error: "Filter sprints by active, none, or a sprint number." };

/** `active` and `none` as the REST filter reads them, or a number as JSON gives it. */
const sprintFilterOf = (sprint: "active" | "none" | number): SprintFilter =>
  typeof sprint === "number" ? { kind: "number", number: sprint } : { kind: sprint };

/**
 * "me" is the calling Agent. The REST forms (unassigned, agents, users,
 * user:<id>, agent:<id>) come next, and anything else is a handle, as
 * assign_ticket takes it.
 */
async function assigneeFilterOf({ deps, ctx }: ToolEnv, handle: string): Promise<AssigneeFilter> {
  if (handle === "me") return { kind: "actor", actor: refOf(ctx.actor) };
  const named = assigneeFilter.safeParse(handle);
  if (named.success) return named.data;
  return { kind: "actor", actor: await findAssignee(deps, ctx, handle) };
}

const input = listTicketsQuery
  .pick({ projectKey: true, status: true, type: true, priority: true, q: true, cursor: true })
  .extend({
    assignee: z
      .string({ error: assigneeError })
      .trim()
      .min(1, { error: assigneeError })
      .optional()
      .describe(
        "Who the tickets are assigned to: me, unassigned, agents, users, a user's email, or an agent's name.",
      ),
    parentKey: listTicketsQuery.shape.parentKey.describe(
      "Only children of this ticket key, such as CB-42.",
    ),
    q: listTicketsQuery.shape.q.describe("Words to find in the title or description."),
    label: listTicketsQuery.shape.label.describe(
      "Only tickets with this label, such as api, in any case. See list_labels.",
    ),
    limit: z
      .number(limitError)
      .int(limitError)
      .min(1, limitError)
      .max(100, limitError)
      .default(20)
      .describe("How many tickets to return. Defaults to 20."),
    cursor: listTicketsQuery.shape.cursor.describe("nextCursor from the previous page."),
    sprint: z
      .union([z.enum(["active", "none"]), sprintNumber], sprintError)
      .optional()
      .describe(
        "active for the tickets in the project's active sprint, none for tickets in no sprint, or a sprint number. See list_sprints.",
      ),
    // A JSON boolean here, where the REST query string takes "true" or "false".
    blocked: z
      .boolean({ error: "Use blocked: true or blocked: false." })
      .optional()
      .describe("true for only blocked tickets, false for only tickets that can start."),
  });

export const listTicketsTool = defineTool({
  name: "list_tickets",
  description:
    "List tickets by ticket key, most urgent first within each status. Filter by project key, status, type, priority, label, sprint, parent ticket key, text, or assignee (me, a user's email, or an agent's name, as tool output shows them). Blocked tickets are marked blocked and can't be claimed until their blockers are done. When looking for work, pass blocked: false with status todo and assignee unassigned, and the first result is the next ticket to claim with claim_ticket. When the project runs sprints (list_sprints lists any), also pass sprint: active, so you only pick work the humans committed to. Archived tickets are left out. Pass nextCursor back as cursor for the next page.",
  input,
  output: z.object({
    tickets: z.array(ticketSummary),
    nextCursor: ticketPage.shape.nextCursor,
  }),
  annotations: { readOnlyHint: true },
  async run({ assignee, sprint, ...filter }, env) {
    const { deps, ctx } = env;
    const page = await listTickets(
      deps,
      ctx,
      {
        ...filter,
        assignee: assignee === undefined ? undefined : await assigneeFilterOf(env, assignee),
        sprint: sprint === undefined ? undefined : sprintFilterOf(sprint),
        archived: "exclude",
      },
      { order: "urgency" },
    );
    const tickets = (await withEmails(env, { tickets: page.tickets })).tickets.map(summarize);
    let markdown = bulletList(
      "Tickets",
      tickets.map((ticket) => ticketLine(ticket)),
      "No tickets match.",
    );
    if (page.nextCursor) markdown += `\n\nMore tickets match. Next cursor: ${page.nextCursor}`;
    return { data: { tickets, nextCursor: page.nextCursor }, markdown };
  },
});
