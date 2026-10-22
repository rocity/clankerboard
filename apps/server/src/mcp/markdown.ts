import type { ActorView, CommentView, TicketView } from "@clankerboard/domain";
import { statusLabels } from "@clankerboard/shared";

// Markdown for an LLM reader: short, flat, and keyed by Ticket Key or Project Key.

/** A `## heading` and one bullet per line, or the empty text when there are none. */
export function bulletList(heading: string, lines: string[], empty: string) {
  if (lines.length === 0) return `## ${heading}\n\n${empty}`;
  return `## ${heading}\n\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

/** "Claude-1 (agent)" or "Ada", so the model can tell Agents from Users. */
export function actorLabel(actor: ActorView) {
  if (actor.type === "user") return actor.name;
  return `${actor.name} (agent${actor.revoked ? ", revoked" : ""})`;
}

type TicketSummary = Pick<TicketView, "key" | "title" | "type" | "status" | "priority"> & {
  assignee: ActorView | null;
};

/** One line per Ticket: `**CB-3** [task, To Do, medium] Title (assignee: Ada)`. */
export function ticketLine(ticket: TicketSummary) {
  const assignee = ticket.assignee ? `assignee: ${actorLabel(ticket.assignee)}` : "unassigned";
  return `**${ticket.key}** [${ticket.type}, ${statusLabels[ticket.status]}, ${ticket.priority}] ${ticket.title} (${assignee})`;
}

/** A Ticket's fields and description, without its children or Comments. */
export function ticketMarkdown(ticket: TicketView) {
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
export function commentsMarkdown(comments: CommentView[]) {
  if (comments.length === 0) return "## Comments\n\nNo comments yet.";
  const entries = comments.map(
    (c) => `### ${actorLabel(c.author)}, ${c.createdAt.toISOString()}\n\n${c.body}`,
  );
  return `## Comments\n\n${entries.join("\n\n")}`;
}
