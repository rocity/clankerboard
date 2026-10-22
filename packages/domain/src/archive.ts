import type { Tx } from "@agentkanban/db";
import { eq } from "drizzle-orm";
import { type RecordActivity, withActivity } from "./activity";
import { watchDependents } from "./blocked";
import type { CompanyContext, DomainDeps } from "./context";
import { conflict } from "./errors";
import { assertMayArchive, assertMayHardDelete } from "./permissions";
import {
  findTicket,
  saveTicket,
  type TicketRow,
  type TicketView,
  ticketActivity,
  ticketColumns,
  ticketKeyOf,
  tickets,
} from "./ticket-store";

/** Clears the Parent of every child, recording each detachment. Returns their keys. */
async function detachChildren(tx: Tx, parent: TicketRow, record: RecordActivity) {
  const children = await tx
    .update(tickets)
    .set({ parentId: null })
    .where(eq(tickets.parentId, parent.id))
    .returning(ticketColumns);
  const keys: string[] = [];
  for (const child of children.sort((a, b) => a.number - b.number)) {
    const key = ticketKeyOf({ projectKey: parent.projectKey, number: child.number });
    keys.push(key);
    await record({
      projectId: child.projectId,
      ticketId: child.id,
      ticketKey: key,
      kind: "ticket.detached",
      payload: { parent: ticketKeyOf(parent) },
    });
  }
  return keys;
}

/** Hides a Ticket from the board, keeping its Comments and Activity. Its children stay live, without a Parent. */
export async function archiveTicket(
  deps: DomainDeps,
  ctx: CompanyContext,
  key: string,
): Promise<TicketView> {
  assertMayArchive(ctx);
  return withActivity(deps, ctx, async (tx, record) => {
    const row = await findTicket(tx, ctx, key, true);
    if (row.archivedAt) throw conflict("This ticket is already archived.");
    const now = deps.clock.now();
    const recordFlips = await watchDependents(tx, row);
    const detached = await detachChildren(tx, row, record);
    const view = await saveTicket(tx, row, { archivedAt: now, updatedAt: now });
    await record(ticketActivity(row, "ticket.archived", { detached }));
    await recordFlips(record, "archived");
    return view;
  });
}

/** Brings an archived Ticket back. Detached children are not re-attached. */
export async function restoreTicket(
  deps: DomainDeps,
  ctx: CompanyContext,
  key: string,
): Promise<TicketView> {
  assertMayArchive(ctx);
  return withActivity(deps, ctx, async (tx, record) => {
    const row = await findTicket(tx, ctx, key, true);
    if (!row.archivedAt) throw conflict("This ticket isn't archived.");
    const recordFlips = await watchDependents(tx, row);
    const view = await saveTicket(tx, row, { archivedAt: null, updatedAt: deps.clock.now() });
    await record(ticketActivity(row, "ticket.restored"));
    await recordFlips(record, "restored");
    return view;
  });
}

/**
 * Purges a Ticket with its Comments and Activity. Children are detached, and
 * the deletion itself is recorded on the Project. Its number is never reused.
 */
export async function deleteTicket(deps: DomainDeps, ctx: CompanyContext, key: string) {
  assertMayHardDelete(ctx);
  await withActivity(deps, ctx, async (tx, record) => {
    const row = await findTicket(tx, ctx, key, true);
    // Its Links go with it, by cascade, so a Ticket it blocked may be unblocked.
    const recordFlips = await watchDependents(tx, row);
    await detachChildren(tx, row, record);
    await tx.delete(tickets).where(eq(tickets.id, row.id));
    await record({
      projectId: row.projectId,
      ticketKey: ticketKeyOf(row),
      kind: "ticket.deleted",
      // Only the key: the point of a hard delete is that the content is gone.
      payload: { ticketKey: ticketKeyOf(row) },
    });
    await recordFlips(record, "deleted");
  });
}
