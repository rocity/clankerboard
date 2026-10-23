import {
  type ActorView,
  type CommentView,
  listLinks,
  memberEmails,
  type TicketLinkView,
  type TicketView,
} from "@agentkanban/domain";
import { actorView, commentView, ticketLinkView, ticketView } from "@agentkanban/shared";
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

export const mcpTicketLinkView = ticketLinkView.extend({ createdBy: mcpActorView });
export type McpTicketLinkView = z.output<typeof mcpTicketLinkView>;

/** A Ticket in a list: enough to pick it, not its description. Labels are names only. */
export const ticketSummary = mcpTicketView
  .pick({
    key: true,
    title: true,
    type: true,
    status: true,
    priority: true,
    estimate: true,
    progress: true,
    blocked: true,
    assignee: true,
    parent: true,
  })
  .extend({ labels: z.array(z.string()) });
export type TicketSummary = z.output<typeof ticketSummary>;

export function summarize(ticket: McpTicketView): TicketSummary {
  const { key, title, type, status, priority, estimate, progress, blocked, assignee, parent } =
    ticket;
  const labels = ticket.labels.map((label) => label.name);
  return {
    key,
    title,
    type,
    status,
    priority,
    estimate,
    progress,
    blocked,
    assignee,
    parent,
    labels,
  };
}

/**
 * Adds each User's email to these Tickets, Comments, and Ticket Links, in one
 * query. A former member has none, since `assign_ticket` can't take them anyway.
 */
export async function withEmails(
  { deps, ctx }: ToolEnv,
  {
    tickets = [],
    comments = [],
    links = [],
  }: { tickets?: TicketView[]; comments?: CommentView[]; links?: TicketLinkView[] },
): Promise<{ tickets: McpTicketView[]; comments: McpCommentView[]; links: McpTicketLinkView[] }> {
  const actors = [
    ...tickets.flatMap((ticket) => [ticket.assignee, ticket.createdBy]),
    ...comments.map((comment) => comment.author),
    ...links.map((link) => link.createdBy),
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
    links: links.map((link) => ({ ...link, createdBy: add(link.createdBy) })),
  };
}

/** One Ticket with its Users' emails. */
export async function ticketWithEmails(env: ToolEnv, ticket: TicketView): Promise<McpTicketView> {
  const { tickets } = await withEmails(env, { tickets: [ticket] });
  return tickets[0] as McpTicketView;
}

/** A Ticket's Ticket Links as seen from it, grouped Blocked by, Blocks, then Related. */
export async function linksWithEmails(env: ToolEnv, key: string): Promise<McpTicketLinkView[]> {
  const { links } = await withEmails(env, { links: await listLinks(env.deps, env.ctx, key) });
  return links;
}

/** One Comment with its author's email. */
export async function commentWithEmails(
  env: ToolEnv,
  comment: CommentView,
): Promise<McpCommentView> {
  const { comments } = await withEmails(env, { comments: [comment] });
  return comments[0] as McpCommentView;
}
