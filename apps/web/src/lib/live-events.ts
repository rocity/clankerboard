import type { QueryClient } from "@tanstack/react-query";
import { actorsQuery } from "./actors";
import type { TicketData } from "./board";
import { highlightTicket } from "./live-highlight";
import { isMoving } from "./move-ticket";
import { projectKeys } from "./projects";
import { sessionQuery } from "./queries";
import { dropTicket, putTicket, ticketKeys } from "./tickets";

/** An Activity as the stream sends it (`streamedActivity` in shared, with timestamps as text). */
export type LiveEvent = {
  activity: {
    id: number;
    kind: string;
    ticketKey: string | null;
    actor: { type: "user" | "agent"; id: string; name: string };
    payload: Record<string, unknown>;
  };
  /** The Ticket as it is now. Null for Project Activity and a deleted Ticket. */
  ticket: TicketData | null;
};

/** Activity that changes a Ticket's own fields, Status, place, or Assignee. */
const ticketChanges = [
  "ticket.created",
  "ticket.updated",
  "ticket.moved",
  "ticket.assigned",
  "ticket.claimed",
  "ticket.archived",
  "ticket.restored",
  "ticket.detached",
  // A blocker changed elsewhere, so the card gains or loses its Blocked marker.
  "ticket.blocked",
  "ticket.unblocked",
] as const;

/** Every named event the stream sends besides `resync` and `unauthorized`. */
export const activityKinds = [
  ...ticketChanges,
  // Each carries a snapshot, but the card shows no change of its own: when a
  // Blocks Link flips Blocked, a `ticket.blocked` or `ticket.unblocked` follows.
  "ticket.linked",
  "ticket.unlinked",
  "ticket.deleted",
  "comment.added",
  "project.created",
  "project.updated",
  "project.deleted",
] as const;

/** Parses an event's data, or null when it is not an Activity this app understands. */
export function parseLiveEvent(data: unknown): LiveEvent | null {
  if (typeof data !== "string") return null;
  try {
    const event = JSON.parse(data) as LiveEvent;
    return event?.activity && typeof event.activity.kind === "string" ? event : null;
  } catch {
    return null;
  }
}

/** The Project Key inside a Ticket Key such as `CB-12`. */
const projectKeyOf = (ticketKey: string) => ticketKey.slice(0, ticketKey.lastIndexOf("-"));

/**
 * Applies one Activity to the cache. A Ticket's snapshot goes straight into
 * every board view that should hold it (no refetch), and what a snapshot cannot
 * carry (a Comment's text, a Project) is refetched only where it is on screen.
 */
export function applyLiveEvent(queryClient: QueryClient, { activity, ticket }: LiveEvent) {
  const me = queryClient.getQueryData(sessionQuery.queryKey);
  const mine = activity.actor.type === "user" && activity.actor.id === me?.id;
  const { kind } = activity;

  // An Actor the cached list has never heard of (a new Agent) is named in the Timeline by that list.
  const known = queryClient.getQueryData(actorsQuery.queryKey);
  if (known && !known.some((a) => a.type === activity.actor.type && a.id === activity.actor.id)) {
    void queryClient.invalidateQueries({ queryKey: actorsQuery.queryKey });
  }

  if (kind.startsWith("project.")) {
    void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    const key = activity.payload.key;
    if (kind === "project.deleted" && typeof key === "string") {
      void queryClient.invalidateQueries({ queryKey: ticketKeys.board(key) });
    }
    return;
  }

  const key = ticket?.key ?? activity.ticketKey;
  if (!key) return;

  if (kind === "ticket.deleted") {
    dropTicket(queryClient, projectKeyOf(key), key);
    // An open panel for it finds out the Ticket is gone. The User who deleted
    // it is already on their way back to the board.
    if (!mine) void queryClient.invalidateQueries({ queryKey: ticketKeys.detail(key) });
  } else if (ticket) {
    // The echo of this tab's own move arrives while the move is still out. The
    // optimistic copy and the move's own answer already show it, and the
    // snapshot could be older than a second move made since.
    if (!(mine && isMoving(key))) putTicket(queryClient, ticket);
    if (!mine && (ticketChanges as readonly string[]).includes(kind)) highlightTicket(key);
  }

  // Every Activity adds a Timeline line, and a Comment's body is not in the event.
  void queryClient.invalidateQueries({ queryKey: ticketKeys.timeline(key) });
  if (kind !== "comment.added") {
    // A Parent's children change when a Ticket is created, re-parented, archived, or deleted.
    void queryClient.invalidateQueries({ queryKey: ["tickets", "children"] });
  }
}

/** `resync`: the server cannot replay what was missed, so everything on screen is read again. */
export function resync(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ticketKeys.all });
  void queryClient.invalidateQueries({ queryKey: projectKeys.all });
}
