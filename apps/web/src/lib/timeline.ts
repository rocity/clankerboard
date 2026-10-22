import { statusLabels, type TicketStatus } from "@clankerboard/shared";

export const capitalized = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

type ActorRef = { type?: unknown; id?: unknown } | null | undefined;
type Change = { from?: unknown; to?: unknown };

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

function statusLabel(value: unknown) {
  return typeof value === "string" && value in statusLabels
    ? statusLabels[value as TicketStatus]
    : "another status";
}

function describeChange(field: string, change: Change) {
  const from = typeof change.from === "string" ? change.from : null;
  const to = typeof change.to === "string" ? change.to : null;
  switch (field) {
    case "title":
      return `renamed this from "${from ?? ""}" to "${to ?? ""}"`;
    case "description":
      return "edited the description";
    case "type":
    case "priority":
      return `changed the ${field} from ${from ?? "none"} to ${to ?? "none"}`;
    case "parent":
      if (!to) return `removed the parent ${from ?? ""}`.trim();
      return from ? `changed the parent from ${from} to ${to}` : `set the parent to ${to}`;
    case "estimate": {
      // Estimates are numbers, and zero is a size, so only null means blank.
      const before = typeof change.from === "number" ? change.from : null;
      const after = typeof change.to === "number" ? change.to : null;
      if (after === null) return "cleared the estimate";
      return before === null
        ? `set the estimate to ${after}`
        : `changed the estimate from ${before} to ${after}`;
    }
    default:
      return `changed the ${field}`;
  }
}

/**
 * What an Activity says, to follow the Actor's name: "moved this from To Do to
 * In Progress". `actorName` turns an Actor reference (type and id only, as
 * Assignee changes record them) into a name.
 */
export function describeActivity(
  kind: string,
  payload: Record<string, unknown>,
  actorName: (ref: ActorRef) => string,
) {
  switch (kind) {
    case "ticket.created":
      return "created this ticket";
    case "ticket.updated": {
      const changes = Object.entries(asRecord(payload.changes)).map(([field, change]) =>
        describeChange(field, asRecord(change)),
      );
      return changes.length > 0 ? changes.join(", ") : "updated this ticket";
    }
    case "ticket.moved": {
      const from = asRecord(payload.from);
      const to = asRecord(payload.to);
      return from.status === to.status
        ? `reordered this within ${statusLabel(to.status)}`
        : `moved this from ${statusLabel(from.status)} to ${statusLabel(to.status)}`;
    }
    case "ticket.assigned": {
      const to = payload.to as ActorRef;
      return to ? `assigned this to ${actorName(to)}` : "unassigned this";
    }
    case "ticket.claimed":
      return "claimed this ticket";
    case "ticket.archived":
      return "archived this ticket";
    case "ticket.restored":
      return "restored this ticket";
    case "ticket.detached":
      return typeof payload.parent === "string"
        ? `detached this from ${payload.parent}`
        : "detached this from its parent";
    default:
      return "changed this ticket";
  }
}
