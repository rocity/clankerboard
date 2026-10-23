import { randomUUID } from "node:crypto";
import type { Db, Tx } from "@agentkanban/db";
import {
  defaultLabelColor,
  type LabelView,
  normalizeLabelName,
  type TicketLabelView,
  type UpdateLabelInput,
} from "@agentkanban/shared";
import { and, asc, count, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { withActivity } from "./activity";
import { actorColumns, refOf } from "./actors";
import type { Changes } from "./changes";
import type { CompanyContext, DomainDeps } from "./context";
import { conflict, notFound } from "./errors";
import { assertMayManageLabels } from "./permissions";
import {
  labels,
  labelsOf,
  selectTickets,
  ticketActivity,
  ticketLabels,
  tickets,
} from "./ticket-store";

export type { LabelView };

/**
 * The Labels of these names, in the order given, creating any the Company
 * doesn't have yet with their starting color, credited to the acting Actor.
 * Names match without regard to case, so `API` finds `api`.
 */
export async function resolveLabels(
  tx: Tx,
  ctx: CompanyContext,
  names: string[],
  now: Date,
): Promise<TicketLabelView[]> {
  if (names.length === 0) return [];
  const creator = actorColumns(refOf(ctx.actor));
  // A name some other change created first is left as that change spelled it.
  await tx
    .insert(labels)
    .values(
      names.map((name) => ({
        id: randomUUID(),
        companyId: ctx.companyId,
        name,
        color: defaultLabelColor(name),
        createdByUserId: creator.userId,
        createdByAgentId: creator.agentId,
        createdAt: now,
      })),
    )
    .onConflictDoNothing();
  const found = await tx
    .select({ id: labels.id, name: labels.name, color: labels.color })
    .from(labels)
    .where(
      and(
        eq(labels.companyId, ctx.companyId),
        inArray(sql`lower(${labels.name})`, names.map(normalizeLabelName)),
      ),
    );
  const byName = new Map(found.map((label) => [normalizeLabelName(label.name), label]));
  return names.flatMap((name) => byName.get(normalizeLabelName(name)) ?? []);
}

/** Label names in the order Tickets show them. */
const inNameOrder = (names: string[]) =>
  [...names].sort((a, b) => normalizeLabelName(a).localeCompare(normalizeLabelName(b)));

/**
 * The `labels` entry of a `ticket.updated` diff, or nothing when the two sets
 * hold the same Labels.
 */
export function labelChanges(from: TicketLabelView[], to: TicketLabelView[]): Changes {
  const ids = (set: TicketLabelView[]) => [...new Set(set.map((l) => l.id))].sort().join();
  if (ids(from) === ids(to)) return {};
  return {
    labels: {
      from: inNameOrder(from.map((l) => l.name)),
      to: inNameOrder(to.map((l) => l.name)),
    },
  };
}

/** Makes `labelIds` the whole set of Labels a Ticket carries. */
export async function setTicketLabels(tx: Tx, ticketId: string, labelIds: string[], now: Date) {
  await tx
    .delete(ticketLabels)
    .where(
      and(
        eq(ticketLabels.ticketId, ticketId),
        labelIds.length === 0 ? undefined : notInArray(ticketLabels.labelId, labelIds),
      ),
    );
  if (labelIds.length === 0) return;
  await tx
    .insert(ticketLabels)
    .values(labelIds.map((labelId) => ({ ticketId, labelId, createdAt: now })))
    .onConflictDoNothing();
}

/**
 * How many live Tickets carry each Label. Every User sees every Project
 * (`canSeeProject`), so no Ticket is left out of a count for being hidden.
 */
async function liveTicketCounts(tx: Db | Tx, labelIds: string[]) {
  if (labelIds.length === 0) return new Map<string, number>();
  const rows = await tx
    .select({ labelId: ticketLabels.labelId, count: count() })
    .from(ticketLabels)
    .innerJoin(tickets, eq(tickets.id, ticketLabels.ticketId))
    .where(and(inArray(ticketLabels.labelId, labelIds), isNull(tickets.archivedAt)))
    .groupBy(ticketLabels.labelId);
  return new Map(rows.map((row) => [row.labelId, row.count]));
}

type LabelRow = typeof labels.$inferSelect;

async function labelViews(db: Db | Tx, rows: LabelRow[]): Promise<LabelView[]> {
  const counts = await liveTicketCounts(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    ticketCount: counts.get(row.id) ?? 0,
    createdAt: row.createdAt,
  }));
}

/** Every Label of the Company, in name order. */
export async function listLabels({ db }: DomainDeps, ctx: CompanyContext): Promise<LabelView[]> {
  const rows = await db
    .select()
    .from(labels)
    .where(eq(labels.companyId, ctx.companyId))
    .orderBy(sql`lower(${labels.name})`, labels.id);
  return labelViews(db, rows);
}

async function findLabel(tx: Tx, ctx: CompanyContext, id: string) {
  const [row] = await tx
    .select()
    .from(labels)
    .where(and(eq(labels.id, id), eq(labels.companyId, ctx.companyId)))
    .for("update");
  if (!row) throw notFound();
  return row;
}

/**
 * Renames or recolors a Label. No Ticket's set of Labels changes, so no
 * Activity is recorded; it runs under the Activity lock all the same, so it
 * can't race a change that creates a Label of the new name.
 */
export async function updateLabel(
  deps: DomainDeps,
  ctx: CompanyContext,
  id: string,
  input: UpdateLabelInput,
): Promise<LabelView> {
  assertMayManageLabels(ctx);
  return withActivity(deps, ctx, async (tx) => {
    const row = await findLabel(tx, ctx, id);
    if (input.name !== undefined) {
      const [taken] = await tx
        .select({ name: labels.name })
        .from(labels)
        .where(
          and(
            eq(labels.companyId, ctx.companyId),
            ne(labels.id, row.id),
            sql`lower(${labels.name}) = ${normalizeLabelName(input.name)}`,
          ),
        );
      if (taken) throw conflict(`A label named ${taken.name} already exists.`);
    }
    const [updated] = await tx
      .update(labels)
      .set({ name: input.name ?? row.name, color: input.color ?? row.color })
      .where(eq(labels.id, row.id))
      .returning();
    if (!updated) throw notFound();
    const [view] = await labelViews(tx, [updated]);
    if (!view) throw notFound();
    return view;
  });
}

/**
 * Deletes a Label, taking it off every Ticket that carried it. Each of those
 * Tickets, archived ones too, records the removal as a `ticket.updated` diff,
 * so its Timeline says where the Label went and open boards get its snapshot.
 */
export async function deleteLabel(deps: DomainDeps, ctx: CompanyContext, id: string) {
  assertMayManageLabels(ctx);
  await withActivity(deps, ctx, async (tx, record) => {
    const label = await findLabel(tx, ctx, id);
    const carriers = await selectTickets(tx)
      .innerJoin(ticketLabels, eq(ticketLabels.ticketId, tickets.id))
      .where(eq(ticketLabels.labelId, label.id))
      .orderBy(asc(tickets.id))
      .for("update", { of: tickets });
    const before = await labelsOf(
      tx,
      carriers.map((row) => row.id),
    );
    await tx.delete(labels).where(eq(labels.id, label.id));
    const now = deps.clock.now();
    for (const row of carriers) {
      const from = before.get(row.id) ?? [];
      await tx.update(tickets).set({ updatedAt: now }).where(eq(tickets.id, row.id));
      await record(
        ticketActivity(row, "ticket.updated", {
          changes: labelChanges(
            from,
            from.filter((l) => l.id !== label.id),
          ),
        }),
      );
    }
  });
}
