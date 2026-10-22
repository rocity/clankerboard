// Blocked transitions: Activity on a dependent whose Blocked state flipped
// because of a change to another Ticket (ADR-0009). Not part of the domain
// module's public surface.
import type { Tx } from "@agentkanban/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { RecordActivity } from "./activity";
import {
  openBlockers,
  projects,
  selectTickets,
  type TicketRow,
  ticketActivity,
  ticketKeyOf,
  ticketLinks,
  tickets,
} from "./ticket-store";

/** Why a dependent's Blocked state flipped. */
export type BlockedReason =
  | "done"
  | "reopened"
  | "archived"
  | "restored"
  | "deleted"
  | "linked"
  | "unlinked";

/** Records Activity on each watched Ticket whose Blocked state flipped since watching began. */
export type RecordFlips = (record: RecordActivity, reason: BlockedReason) => Promise<void>;

/**
 * Notes the Blocked state of `ticketIds` before a change to `cause`. Call
 * the result after the change, in the same transaction, to record
 * `ticket.blocked` or `ticket.unblocked` on each one that flipped, crediting
 * the acting Actor.
 */
export async function watchBlocked(
  tx: Tx,
  ticketIds: string[],
  cause: TicketRow,
): Promise<RecordFlips> {
  const isBlocked = async () => {
    const blockers = await openBlockers(tx, ticketIds);
    return new Map(ticketIds.map((id) => [id, (blockers.get(id)?.length ?? 0) > 0]));
  };
  const before = await isBlocked();
  const causeKey = ticketKeyOf(cause);
  return async (record, reason) => {
    if (ticketIds.length === 0) return;
    const after = await isBlocked();
    const flipped = ticketIds.filter((id) => before.get(id) !== after.get(id));
    if (flipped.length === 0) return;
    const rows = await selectTickets(tx)
      .where(inArray(tickets.id, flipped))
      .orderBy(asc(projects.key), asc(tickets.number));
    for (const row of rows) {
      const kind = after.get(row.id) ? "ticket.blocked" : "ticket.unblocked";
      await record(ticketActivity(row, kind, { ticket: causeKey, reason }));
    }
  };
}

/** `watchBlocked` for every Ticket that `blocker` blocks. */
export async function watchDependents(tx: Tx, blocker: TicketRow): Promise<RecordFlips> {
  const dependents = await tx
    .select({ id: ticketLinks.toTicketId })
    .from(ticketLinks)
    .where(and(eq(ticketLinks.fromTicketId, blocker.id), eq(ticketLinks.kind, "blocks")));
  return watchBlocked(
    tx,
    dependents.map((d) => d.id),
    blocker,
  );
}
