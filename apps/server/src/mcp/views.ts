import {
  type ActorView,
  type CommentView,
  memberEmails,
  type TicketView,
} from "@clankerboard/domain";
import { actorView, commentView, ticketView } from "@clankerboard/shared";
import { z } from "zod";
import type { ToolEnv } from "./tool";

// What MCP output shows. Agents know Actors by what they read, so a User
// carries their email, the handle assign_ticket and list_tickets take. REST
// views stay as they are.

export const mcpActorView = actorView.extend({
  email: z
    .string()
    .nullable()
    .describe("A user's email, to pass to assign_ticket or list_tickets. Null for agents."),
});
export type McpActorView = z.output<typeof mcpActorView>;

export const mcpTicketView = ticketView.extend({
  assignee: mcpActorView.nullable(),
  createdBy: mcpActorView,
});
export type McpTicketView = z.output<typeof mcpTicketView>;

export const mcpCommentView = commentView.extend({ author: mcpActorView });
export type McpCommentView = z.output<typeof mcpCommentView>;

/** A Ticket in a list: enough to pick it, not its description. */
export const ticketSummary = mcpTicketView.pick({
  key: true,
  title: true,
  type: true,
  status: true,
  priority: true,
  estimate: true,
  assignee: true,
  parent: true,
});
export type TicketSummary = z.output<typeof ticketSummary>;

export function summarize(ticket: McpTicketView): TicketSummary {
  const { key, title, type, status, priority, estimate, assignee, parent } = ticket;
  return { key, title, type, status, priority, estimate, assignee, parent };
}

/**
 * Adds each User's email to these Tickets and Comments, in one query. A
 * former member has none, since `assign_ticket` can't take them anyway.
 */
export async function withEmails(
  { deps, ctx }: ToolEnv,
  { tickets = [], comments = [] }: { tickets?: TicketView[]; comments?: CommentView[] },
): Promise<{ tickets: McpTicketView[]; comments: McpCommentView[] }> {
  const actors = [
    ...tickets.flatMap((ticket) => [ticket.assignee, ticket.createdBy]),
    ...comments.map((comment) => comment.author),
  ];
  const userIds = actors.flatMap((actor) => (actor?.type === "user" ? [actor.id] : []));
  const emails = await memberEmails(deps, ctx, [...new Set(userIds)]);
  const add = (actor: ActorView): McpActorView => ({
    ...actor,
    email: (actor.type === "user" && emails.get(actor.id)) || null,
  });
  return {
    tickets: tickets.map((ticket) => ({
      ...ticket,
      assignee: ticket.assignee && add(ticket.assignee),
      createdBy: add(ticket.createdBy),
    })),
    comments: comments.map((comment) => ({ ...comment, author: add(comment.author) })),
  };
}

/** One Ticket with its Users' emails. */
export async function ticketWithEmails(env: ToolEnv, ticket: TicketView): Promise<McpTicketView> {
  const { tickets } = await withEmails(env, { tickets: [ticket] });
  return tickets[0] as McpTicketView;
}

/** One Comment with its author's email. */
export async function commentWithEmails(
  env: ToolEnv,
  comment: CommentView,
): Promise<McpCommentView> {
  const { comments } = await withEmails(env, { comments: [comment] });
  return comments[0] as McpCommentView;
}
