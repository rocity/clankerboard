import { statusLabels, type TicketStatus } from "@agentkanban/shared";

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
    case "labels":
      return describeLabels(change);
    case "progress": {
      // Like the Estimate, 0% is a value, so only null means blank.
      const before = typeof change.from === "number" ? change.from : null;
      const after = typeof change.to === "number" ? change.to : null;
      if (after === null) return "cleared progress";
      return before === null
        ? `set progress to ${after}%`
        : `changed progress from ${before}% to ${after}%`;
    }
    default:
      return `changed the ${field}`;
  }
}

const names = (value: unknown) =>
  Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];

/** "api", "api and web", or "api, docs, and web". */
function inWords(items: string[]) {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/**
 * A Labels change as what was added and what was removed: "added the label
 * api", "removed the labels api and web", or both. Names compare without
 * regard to case, like the Labels themselves.
 */
function describeLabels(change: Change) {
  const from = names(change.from);
  const to = names(change.to);
  const has = (list: string[], name: string) =>
    list.some((other) => other.toLowerCase() === name.toLowerCase());
  const added = to.filter((name) => !has(from, name));
  const removed = from.filter((name) => !has(to, name));
  const phrase = (verb: string, list: string[]) =>
    `${verb} the ${list.length === 1 ? "label" : "labels"} ${inWords(list)}`;
  const parts = [
    ...(added.length > 0 ? [phrase("added", added)] : []),
    ...(removed.length > 0 ? [phrase("removed", removed)] : []),
  ];
  return parts.join(" and ") || "changed the labels";
}

/** A Ticket Link being added, as seen from the Ticket whose Timeline it is on. */
function describeLinked(kind: unknown, other: string) {
  switch (kind) {
    case "blocked_by":
      return `marked this as blocked by ${other}`;
    case "blocks":
      return `marked this as blocking ${other}`;
    default:
      return `linked this to ${other}`;
  }
}

/**
 * What another Ticket's change did, as the first half of a Blocked transition:
 * "moved CB-3 to Done", then ", so this is no longer blocked".
 */
function describeCause(reason: unknown, other: string | null) {
  if (!other) return "changed a blocking ticket";
  switch (reason) {
    case "done":
      return `moved ${other} to Done`;
    case "reopened":
      return `moved ${other} out of Done`;
    case "archived":
      return `archived ${other}`;
    case "restored":
      return `restored ${other}`;
    case "deleted":
      return `deleted ${other}`;
    case "linked":
      return `marked ${other} as blocking this`;
    case "unlinked":
      return `removed the link to ${other}`;
    default:
      return `changed ${other}`;
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
  // Ticket Link and Blocked Activity name the other Ticket here.
  const other = typeof payload.ticket === "string" ? payload.ticket : null;
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
    case "ticket.linked":
      return describeLinked(payload.kind, other ?? "another ticket");
    case "ticket.unlinked":
      return `removed the link to ${other ?? "another ticket"}`;
    case "ticket.blocked":
      return `${describeCause(payload.reason, other)}, so this is blocked`;
    case "ticket.unblocked":
      return `${describeCause(payload.reason, other)}, so this is no longer blocked`;
    default:
      return "changed this ticket";
  }
}
