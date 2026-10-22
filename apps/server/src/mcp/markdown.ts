import { statusLabels, type TicketLinkViewKind, ticketLinkViewKinds } from "@agentkanban/shared";
import type {
  McpActorView,
  McpCommentView,
  McpTicketLinkView,
  McpTicketView,
  TicketSummary,
} from "./views";

// Markdown for an LLM reader: short, flat, and keyed by Ticket Key or Project Key.

/** A `## heading` and one bullet per line, or the empty text when there are none. */
export function bulletList(heading: string, lines: string[], empty: string) {
  if (lines.length === 0) return `## ${heading}\n\n${empty}`;
  return `## ${heading}\n\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

/**
 * "Claude-1 (agent)" or "Ada (ada@example.com)", so the model can tell Agents
 * from Users and has the handle assign_ticket takes.
 */
export function actorLabel(actor: McpActorView) {
  if (actor.type === "user") return actor.email ? `${actor.name} (${actor.email})` : actor.name;
  return `${actor.name} (agent${actor.revoked ? ", revoked" : ""})`;
}

/** "3 pts", or null when the Estimate is blank. */
function points(estimate: number | null) {
  return estimate === null ? null : `${estimate} pts`;
}

/**
 * One line per Ticket: `**CB-3** [task, To Do, medium, 3 pts, blocked] Title (assignee: Ada)`.
 * Leave the Status out where the line already sits under its Status. A blank
 * Estimate and an unblocked Ticket add nothing.
 */
export function ticketLine(ticket: TicketSummary, { status = true } = {}) {
  const estimate = points(ticket.estimate);
  const facts = [
    ticket.type,
    ...(status ? [statusLabels[ticket.status]] : []),
    ticket.priority,
    ...(estimate ? [estimate] : []),
    ...(ticket.blocked ? ["blocked"] : []),
  ];
  const assignee = ticket.assignee ? `assignee: ${actorLabel(ticket.assignee)}` : "unassigned";
  return `**${ticket.key}** [${facts.join(", ")}] ${ticket.title} (${assignee})`;
}

/** A Ticket's fields and description, without its children or Comments. */
export function ticketMarkdown(ticket: McpTicketView) {
  const facts = [
    `Type: ${ticket.type}`,
    `Status: ${statusLabels[ticket.status]}`,
    `Priority: ${ticket.priority}`,
    `Estimate: ${points(ticket.estimate) ?? "none"}`,
    `Assignee: ${ticket.assignee ? actorLabel(ticket.assignee) : "unassigned"}`,
    `Parent: ${ticket.parent ? `**${ticket.parent.key}** [${ticket.parent.type}] ${ticket.parent.title}` : "none"}`,
    `Created by: ${actorLabel(ticket.createdBy)}`,
  ];
  if (ticket.blocked) facts.push("Blocked: yes");
  if (ticket.archivedAt) facts.push("Archived: yes");
  const description = ticket.description.trim() || "No description.";
  return `# ${ticket.key}: ${ticket.title}\n\n${facts.map((f) => `- ${f}`).join("\n")}\n\n## Description\n\n${description}`;
}

const linkGroups: Record<TicketLinkViewKind, string> = {
  blocked_by: "Blocked by",
  blocks: "Blocks",
  relates_to: "Related",
};

/**
 * A linked Ticket in the ticket-line style: `**CB-3** [task, To Do] Title`,
 * with "archived" among the facts when it is.
 */
export function linkLine(link: McpTicketLinkView) {
  const facts = [link.type, statusLabels[link.status], ...(link.archived ? ["archived"] : [])];
  return `**${link.key}** [${facts.join(", ")}] ${link.title}`;
}

/** A Ticket's Ticket Links under Blocked by, Blocks, and Related, leaving out empty groups. */
export function linksMarkdown(links: McpTicketLinkView[]) {
  const groups = ticketLinkViewKinds.flatMap((kind) => {
    const lines = links.filter((link) => link.kind === kind).map((link) => `- ${linkLine(link)}`);
    return lines.length === 0 ? [] : [`### ${linkGroups[kind]}\n\n${lines.join("\n")}`];
  });
  if (groups.length === 0) return "## Linked tickets\n\nNo linked tickets.";
  return `## Linked tickets\n\n${groups.join("\n\n")}`;
}

/** Comments oldest first, each under its author and time. */
export function commentsMarkdown(comments: McpCommentView[]) {
  if (comments.length === 0) return "## Comments\n\nNo comments yet.";
  const entries = comments.map(
    (c) => `### ${actorLabel(c.author)}, ${c.createdAt.toISOString()}\n\n${c.body}`,
  );
  return `## Comments\n\n${entries.join("\n\n")}`;
}
