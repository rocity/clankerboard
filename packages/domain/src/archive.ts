import { schema, type Tx } from "@clankerboard/db";
import { eq } from "drizzle-orm";
import { type RecordActivity, withActivity } from "./activity";
import type { CompanyContext, DomainDeps } from "./context";
import { conflict, forbidden, notFound } from "./errors";
import { assertMayArchive, assertMayDelete, canDeleteBoardContent } from "./permissions";
import {
  findTicket,
  type TicketRow,
  type TicketView,
  ticketColumns,
  ticketKeyOf,
  ticketView,
} from "./tickets";

const { tickets } = schema;

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

/** Hides a Ticket from the board, keeping its history. Its children stay live, without a Parent. */
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
    const detached = await detachChildren(tx, row, record);
    const [updated] = await tx
      .update(tickets)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(tickets.id, row.id))
      .returning(ticketColumns);
    if (!updated) throw notFound();
    await record({
      projectId: row.projectId,
      ticketId: row.id,
      ticketKey: ticketKeyOf(row),
      kind: "ticket.archived",
      payload: { detached },
    });
    return ticketView(tx, { ...updated, projectKey: row.projectKey });
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
    const [updated] = await tx
      .update(tickets)
      .set({ archivedAt: null, updatedAt: deps.clock.now() })
      .where(eq(tickets.id, row.id))
      .returning(ticketColumns);
    if (!updated) throw notFound();
    await record({
      projectId: row.projectId,
      ticketId: row.id,
      ticketKey: ticketKeyOf(row),
      kind: "ticket.restored",
    });
    return ticketView(tx, { ...updated, projectKey: row.projectKey });
  });
}

/**
 * Purges a Ticket with its Comments and Activity. Children are detached, and
 * the deletion itself is recorded on the Project. Its number is never reused.
 */
export async function deleteTicket(deps: DomainDeps, ctx: CompanyContext, key: string) {
  assertMayDelete(ctx);
  if (!canDeleteBoardContent(ctx.role)) throw forbidden();
  await withActivity(deps, ctx, async (tx, record) => {
    const row = await findTicket(tx, ctx, key, true);
    await detachChildren(tx, row, record);
    await tx.delete(tickets).where(eq(tickets.id, row.id));
    await record({
      projectId: row.projectId,
      ticketKey: ticketKeyOf(row),
      kind: "ticket.deleted",
      // Only the key: the point of a hard delete is that the content is gone.
      payload: { ticketKey: ticketKeyOf(row) },
    });
  });
}
