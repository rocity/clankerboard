// Shared building blocks for the Ticket services: reading Ticket rows within a
// Company, shaping them for the API, and writing a change to one row. Not part
// of the domain module's public surface.
import { type Db, schema, type Tx } from "@agentkanban/db";
import type { SprintState, TicketLabelView, TicketStatus, TicketView } from "@agentkanban/shared";
import { and, asc, desc, eq, getTableColumns, inArray, isNull, ne, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import type { RecordActivity } from "./activity";
import { type ActorView, refFromColumns, resolveActors } from "./actors";
import type { CompanyContext } from "./context";
import { invalid, notFound } from "./errors";
import { canSeeProject } from "./permissions";

export type { TicketView };

export const { tickets, projects, ticketLinks, labels, ticketLabels, sprints } = schema;

export type TicketRow = Omit<typeof tickets.$inferSelect, "search"> & { projectKey: string };

// Every column but the search vector, which only Postgres reads.
export const { search: _search, ...ticketColumns } = getTableColumns(tickets);

export function ticketKeyOf(row: { projectKey: string; number: number }) {
  return `${row.projectKey}-${row.number}`;
}

function parseTicketKey(key: string) {
  const match = /^([A-Za-z]{2,10})-([1-9]\d{0,9})$/.exec(key);
  if (!match?.[1] || !match[2]) throw notFound();
  return { projectKey: match[1].toUpperCase(), number: Number(match[2]) };
}

export function selectTickets(db: Db | Tx) {
  return db
    .select({ ...ticketColumns, projectKey: projects.key })
    .from(tickets)
    .innerJoin(projects, eq(projects.id, tickets.projectId));
}

/**
 * A Ticket the caller may see, by Ticket Key: one whose Project they may see.
 * Pass `lock` inside a transaction to hold it.
 */
export async function findTicket(
  db: Db | Tx,
  ctx: CompanyContext,
  key: string,
  lock = false,
): Promise<TicketRow> {
  const { projectKey, number } = parseTicketKey(key);
  const query = selectTickets(db).where(
    and(
      eq(tickets.companyId, ctx.companyId),
      eq(projects.key, projectKey),
      eq(tickets.number, number),
    ),
  );
  const [row] = lock ? await query.for("update", { of: tickets }) : await query;
  if (!row || !canSeeProject(ctx, row)) throw notFound();
  return row;
}

/** A Ticket the caller may see, by internal id. */
export async function findTicketById(db: Db | Tx, ctx: CompanyContext, id: string) {
  const [row] = await selectTickets(db).where(
    and(eq(tickets.id, id), eq(tickets.companyId, ctx.companyId)),
  );
  if (!row || !canSeeProject(ctx, row)) throw notFound();
  return row;
}

/** A Parent to set, by key: in this Company and not archived. */
export async function findParent(tx: Db | Tx, ctx: CompanyContext, key: string) {
  const parent = await findTicket(tx, ctx, key);
  if (parent.archivedAt) {
    throw invalid(`Restore ${ticketKeyOf(parent)} before adding tickets under it.`);
  }
  return parent;
}

/**
 * Children, oldest first. Archived ones count for the hierarchy rules, since
 * an archived child keeps its Parent and can be restored under it.
 */
export async function childrenOf(db: Db | Tx, ticketId: string, { includeArchived = true } = {}) {
  const rows = await selectTickets(db)
    .where(
      and(eq(tickets.parentId, ticketId), includeArchived ? undefined : isNull(tickets.archivedAt)),
    )
    .orderBy(asc(tickets.number));
  return rows.map((row) => ({ ...row, key: ticketKeyOf(row) }));
}

/**
 * True for a Ticket with an open blocker, one neither Done nor archived: the
 * condition Blocked is derived from, for a query over `tickets`.
 */
export function isBlocked() {
  return sql`exists (
    select 1 from ticket_links l
    join tickets blocker on blocker.id = l.from_ticket_id
    where l.to_ticket_id = ${tickets.id}
      and l.kind = 'blocks'
      and blocker.status <> 'done'
      and blocker.archived_at is null
  )`;
}

/** The Ticket Keys of each Ticket's open blockers, by Ticket id, in key order. */
export async function openBlockers(
  db: Db | Tx,
  ticketIds: string[],
): Promise<Map<string, string[]>> {
  const byTicket = new Map<string, string[]>(ticketIds.map((id) => [id, []]));
  if (ticketIds.length === 0) return byTicket;
  const rows = await db
    .select({
      blockedId: ticketLinks.toTicketId,
      projectKey: projects.key,
      number: tickets.number,
    })
    .from(ticketLinks)
    .innerJoin(tickets, eq(tickets.id, ticketLinks.fromTicketId))
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .where(
      and(
        inArray(ticketLinks.toTicketId, [...new Set(ticketIds)]),
        eq(ticketLinks.kind, "blocks"),
        // Open, as `isBlocked` counts it.
        ne(tickets.status, "done"),
        isNull(tickets.archivedAt),
      ),
    )
    .orderBy(asc(projects.key), asc(tickets.number));
  for (const row of rows) byTicket.get(row.blockedId)?.push(ticketKeyOf(row));
  return byTicket;
}

/** Each Ticket's Labels, by Ticket id, in name order without regard to case. */
export async function labelsOf(
  db: Db | Tx,
  ticketIds: string[],
): Promise<Map<string, TicketLabelView[]>> {
  const byTicket = new Map<string, TicketLabelView[]>(ticketIds.map((id) => [id, []]));
  if (ticketIds.length === 0) return byTicket;
  const rows = await db
    .select({
      ticketId: ticketLabels.ticketId,
      id: labels.id,
      name: labels.name,
      color: labels.color,
    })
    .from(ticketLabels)
    .innerJoin(labels, eq(labels.id, ticketLabels.labelId))
    .where(inArray(ticketLabels.ticketId, [...new Set(ticketIds)]))
    .orderBy(sql`lower(${labels.name})`);
  for (const { ticketId, ...label } of rows) byTicket.get(ticketId)?.push(label);
  return byTicket;
}

/** Each Sprint's number and state, by Sprint id. */
export async function sprintsOf(
  db: Db | Tx,
  sprintIds: string[],
): Promise<Map<string, { number: number; state: SprintState }>> {
  if (sprintIds.length === 0) return new Map();
  const rows = await db
    .select({ id: sprints.id, number: sprints.number, state: sprints.state })
    .from(sprints)
    .where(inArray(sprints.id, [...new Set(sprintIds)]));
  return new Map(rows.map(({ id, ...sprint }) => [id, sprint]));
}

export async function ticketViews(db: Db | Tx, rows: TicketRow[]): Promise<TicketView[]> {
  const assignees = rows.map((r) => refFromColumns(r.assigneeUserId, r.assigneeAgentId));
  const creators = rows.map((r) => refFromColumns(r.createdByUserId, r.createdByAgentId));
  const actor = await resolveActors(db, [...assignees, ...creators]);
  const parentIds = [...new Set(rows.flatMap((r) => (r.parentId ? [r.parentId] : [])))];
  const parents = new Map(
    parentIds.length === 0
      ? []
      : (await selectTickets(db).where(inArray(tickets.id, parentIds))).map((p) => [
          p.id,
          { key: ticketKeyOf(p), title: p.title, type: p.type },
        ]),
  );
  const blockers = await openBlockers(
    db,
    rows.map((r) => r.id),
  );
  const openBlockerCount = (id: string) => blockers.get(id)?.length ?? 0;
  const labelsByTicket = await labelsOf(
    db,
    rows.map((r) => r.id),
  );
  const sprintById = await sprintsOf(
    db,
    rows.flatMap((r) => (r.sprintId ? [r.sprintId] : [])),
  );
  return rows.map((row, i) => ({
    id: row.id,
    key: ticketKeyOf(row),
    projectKey: row.projectKey,
    number: row.number,
    title: row.title,
    description: row.description,
    type: row.type,
    status: row.status,
    priority: row.priority,
    rank: row.rank,
    estimate: row.estimate,
    progress: row.progress,
    labels: labelsByTicket.get(row.id) ?? [],
    sprint: (row.sprintId && sprintById.get(row.sprintId)) || null,
    blocked: openBlockerCount(row.id) > 0,
    blockedByCount: openBlockerCount(row.id),
    parent: (row.parentId && parents.get(row.parentId)) || null,
    assignee: actor(assignees[i] ?? null),
    createdBy: actor(creators[i] ?? null) as ActorView,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function ticketView(db: Db | Tx, row: TicketRow): Promise<TicketView> {
  const [view] = await ticketViews(db, [row]);
  if (!view) throw notFound();
  return view;
}

/** A rank after the last Ticket in a Status, so new arrivals land at the bottom. */
export async function bottomRank(tx: Db | Tx, projectId: string, status: TicketStatus) {
  const [last] = await tx
    .select({ rank: tickets.rank })
    .from(tickets)
    .where(and(eq(tickets.projectId, projectId), eq(tickets.status, status)))
    .orderBy(desc(tickets.rank))
    .limit(1);
  return generateKeyBetween(last?.rank ?? null, null);
}

/** The Activity input for a change to `row`. */
export function ticketActivity(
  row: TicketRow,
  kind: string,
  payload: Record<string, unknown> = {},
): Parameters<RecordActivity>[0] {
  return { projectId: row.projectId, ticketId: row.id, ticketKey: ticketKeyOf(row), kind, payload };
}

/** Writes `changes` to one Ticket row and returns its new view. */
export async function saveTicket(
  tx: Tx,
  row: TicketRow,
  changes: Partial<typeof tickets.$inferInsert>,
): Promise<TicketView> {
  const [updated] = await tx
    .update(tickets)
    .set(changes)
    .where(eq(tickets.id, row.id))
    .returning(ticketColumns);
  if (!updated) throw notFound();
  return ticketView(tx, { ...updated, projectKey: row.projectKey });
}
