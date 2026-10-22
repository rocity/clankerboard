import { statusLabels } from "@clankerboard/shared";
import type { McpActorView, McpCommentView, McpTicketView, TicketSummary } from "./views";

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

/**
 * One line per Ticket: `**CB-3** [task, To Do, medium] Title (assignee: Ada)`.
 * Leave the Status out where the line already sits under its Status.
 */
export function ticketLine(ticket: TicketSummary, { status = true } = {}) {
  const facts = [ticket.type, ...(status ? [statusLabels[ticket.status]] : []), ticket.priority];
  const assignee = ticket.assignee ? `assignee: ${actorLabel(ticket.assignee)}` : "unassigned";
  return `**${ticket.key}** [${facts.join(", ")}] ${ticket.title} (${assignee})`;
}

/** A Ticket's fields and description, without its children or Comments. */
export function ticketMarkdown(ticket: McpTicketView) {
  const facts = [
    `Type: ${ticket.type}`,
    `Status: ${statusLabels[ticket.status]}`,
    `Priority: ${ticket.priority}`,
    `Assignee: ${ticket.assignee ? actorLabel(ticket.assignee) : "unassigned"}`,
    `Parent: ${ticket.parent ? `**${ticket.parent.key}** [${ticket.parent.type}] ${ticket.parent.title}` : "none"}`,
    `Created by: ${actorLabel(ticket.createdBy)}`,
  ];
  if (ticket.archivedAt) facts.push("Archived: yes");
  const description = ticket.description.trim() || "No description.";
  return `# ${ticket.key}: ${ticket.title}\n\n${facts.map((f) => `- ${f}`).join("\n")}\n\n## Description\n\n${description}`;
}

/** Comments oldest first, each under its author and time. */
export function commentsMarkdown(comments: McpCommentView[]) {
  if (comments.length === 0) return "## Comments\n\nNo comments yet.";
  const entries = comments.map(
    (c) => `### ${actorLabel(c.author)}, ${c.createdAt.toISOString()}\n\n${c.body}`,
  );
  return `## Comments\n\n${entries.join("\n\n")}`;
}
