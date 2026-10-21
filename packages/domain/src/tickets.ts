import { randomUUID } from "node:crypto";
import { type Db, schema, type Tx } from "@clankerboard/db";
import type {
  CreateTicketInput,
  MoveTicketInput,
  TicketPriority,
  TicketStatus,
  TicketType,
  UpdateTicketInput,
} from "@clankerboard/shared";
import { and, asc, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { type ActivityEvent, withActivity } from "./activity";
import {
  type ActorRef,
  type ActorView,
  actorColumns,
  refFromColumns,
  refOf,
  resolveActors,
} from "./actors";
import type { CompanyContext, DomainDeps } from "./context";
import { conflict, invalid, notFound } from "./errors";
import { assertChildrenAccept, assertPlacement } from "./hierarchy";
import { findProject } from "./projects";
import { rankAt } from "./rank";

export type TicketView = {
  id: string;
  key: string;
  projectKey: string;
  number: number;
  title: string;
  description: string;
  type: TicketType;
  status: TicketStatus;
  priority: TicketPriority;
  rank: string;
  parent: { key: string; title: string; type: TicketType } | null;
  assignee: ActorView | null;
  createdBy: ActorView;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ActivityView = Omit<ActivityEvent, "actor" | "companyId"> & { actor: ActorView };

const { tickets, projects, activities } = schema;

export type TicketRow = typeof tickets.$inferSelect & { projectKey: string };

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
    .select({ ...getTableColumns(tickets), projectKey: projects.key })
    .from(tickets)
    .innerJoin(projects, eq(projects.id, tickets.projectId));
}

/** A Ticket in the caller's Company, by Ticket Key. Pass `lock` inside a transaction to hold it. */
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
  if (!row) throw notFound();
  return row;
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

/** A rank after the last Ticket in a Status column, so new arrivals land at the bottom. */
export async function bottomRank(tx: Db | Tx, projectId: string, status: TicketStatus) {
  const [last] = await tx
    .select({ rank: tickets.rank })
    .from(tickets)
    .where(and(eq(tickets.projectId, projectId), eq(tickets.status, status)))
    .orderBy(desc(tickets.rank))
    .limit(1);
  return generateKeyBetween(last?.rank ?? null, null);
}

/** A Status column of a Project, in board order, leaving out one Ticket. */
async function columnOf(tx: Db | Tx, projectId: string, status: TicketStatus, without: string) {
  const rows = await selectTickets(tx)
    .where(
      and(eq(tickets.projectId, projectId), eq(tickets.status, status), isNull(tickets.archivedAt)),
    )
    .orderBy(asc(tickets.rank), asc(tickets.number));
  return rows.filter((row) => row.id !== without).map((row) => ({ ...row, key: ticketKeyOf(row) }));
}

/** Where in `column` the moved Ticket goes, from its neighbours or a position. */
function placeIn(column: { key: string }[], status: TicketStatus, input: MoveTicketInput) {
  const indexOf = (key: string) => {
    const index = column.findIndex((row) => row.key === key.toUpperCase());
    if (index === -1) throw invalid(`${key.toUpperCase()} isn't in the ${status} column.`);
    return index;
  };
  if (input.after) {
    const index = indexOf(input.after) + 1;
    if (input.before && column[index]?.key !== input.before.toUpperCase()) {
      throw conflict("The column changed. Refresh and try again.");
    }
    return index;
  }
  if (input.before) return indexOf(input.before);
  return Math.min(input.position ?? column.length, column.length);
}

/** Moves a Ticket to a Status and a place in that column, updating that one row only. */
export async function moveTicket(
  deps: DomainDeps,
  ctx: CompanyContext,
  key: string,
  input: MoveTicketInput,
): Promise<TicketView> {
  return withActivity(deps, ctx, async (tx, record) => {
    const row = await findTicket(tx, ctx, key, true);
    const status = input.status ?? row.status;
    const column = await columnOf(tx, row.projectId, status, row.id);
    const rank = rankAt(
      column.map((r) => r.rank),
      placeIn(column, status, input),
    );

    const [updated] = await tx
      .update(tickets)
      .set({ status, rank, updatedAt: deps.clock.now() })
      .where(eq(tickets.id, row.id))
      .returning();
    if (!updated) throw notFound();
    await record({
      projectId: row.projectId,
      ticketId: row.id,
      ticketKey: ticketKeyOf(row),
      kind: "ticket.moved",
      payload: { from: { status: row.status, rank: row.rank }, to: { status, rank } },
    });
    return ticketView(tx, { ...updated, projectKey: row.projectKey });
  });
}

export type TicketFilter = {
  projectKey?: string;
  status?: TicketStatus;
};

/** Tickets in board order: by Status column, then rank within it. Archived ones are left out. */
export async function listTickets(
  { db }: DomainDeps,
  ctx: CompanyContext,
  filter: TicketFilter,
): Promise<TicketView[]> {
  const rows = await selectTickets(db)
    .where(
      and(
        eq(tickets.companyId, ctx.companyId),
        isNull(tickets.archivedAt),
        filter.projectKey ? eq(projects.key, filter.projectKey) : undefined,
        filter.status ? eq(tickets.status, filter.status) : undefined,
      ),
    )
    .orderBy(asc(tickets.status), asc(tickets.rank), asc(tickets.number));
  return ticketViews(db, rows);
}

export async function createTicket(
  deps: DomainDeps,
  ctx: CompanyContext,
  input: CreateTicketInput,
): Promise<TicketView> {
  const now = deps.clock.now();
  return withActivity(deps, ctx, async (tx, record) => {
    const project = await findProject(tx, ctx, input.projectKey);
    const parent = input.parentKey ? await findTicket(tx, ctx, input.parentKey) : null;
    assertPlacement({ type: input.type, projectId: project.id }, parent);
    // Taking the number locks the Project row, so concurrent creates queue
    // here and each sees the previous one's rank.
    const [counter] = await tx
      .update(projects)
      .set({ nextTicketNumber: sql`${projects.nextTicketNumber} + 1` })
      .where(eq(projects.id, project.id))
      .returning({ next: projects.nextTicketNumber });
    if (!counter) throw notFound();
    const number = counter.next - 1;
    const creator = actorColumns(refOf(ctx.actor));

    const [row] = await tx
      .insert(tickets)
      .values({
        id: randomUUID(),
        companyId: ctx.companyId,
        projectId: project.id,
        number,
        parentId: parent?.id ?? null,
        title: input.title,
        description: input.description,
        type: input.type,
        priority: input.priority,
        status: "backlog",
        rank: await bottomRank(tx, project.id, "backlog"),
        createdByUserId: creator.userId,
        createdByAgentId: creator.agentId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("ticket insert returned nothing");
    const ticket = { ...row, projectKey: project.key };
    await record({
      projectId: project.id,
      ticketId: row.id,
      ticketKey: ticketKeyOf(ticket),
      kind: "ticket.created",
      payload: {
        title: row.title,
        type: row.type,
        status: row.status,
        priority: row.priority,
        parent: parent ? ticketKeyOf(parent) : null,
      },
    });
    return ticketView(tx, ticket);
  });
}

export async function getTicket({ db }: DomainDeps, ctx: CompanyContext, key: string) {
  return ticketView(db, await findTicket(db, ctx, key));
}

type Changes = Record<string, { from: unknown; to: unknown }>;

/** The fields of `input` that differ from `row`, as from/to pairs. */
export function diff<T extends object>(row: T, input: Partial<T>): Changes {
  const changes: Changes = {};
  for (const [field, to] of Object.entries(input)) {
    const from = row[field as keyof T];
    if (to !== undefined && to !== from) changes[field] = { from, to };
  }
  return changes;
}

export async function updateTicket(
  deps: DomainDeps,
  ctx: CompanyContext,
  key: string,
  input: UpdateTicketInput,
): Promise<TicketView> {
  return withActivity(deps, ctx, async (tx, record) => {
    const row = await findTicket(tx, ctx, key, true);
    const { parentKey, ...fields } = input;
    const changes = diff(row, fields);

    const currentParent = row.parentId ? await findTicketById(tx, row.parentId) : null;
    const parent =
      parentKey === undefined
        ? currentParent
        : parentKey === null
          ? null
          : await findTicket(tx, ctx, parentKey);
    if ((parent?.id ?? null) !== row.parentId) {
      changes.parent = {
        from: currentParent ? ticketKeyOf(currentParent) : null,
        to: parent ? ticketKeyOf(parent) : null,
      };
    }
    if (Object.keys(changes).length === 0) return ticketView(tx, row);

    const type = fields.type ?? row.type;
    assertPlacement({ type, projectId: row.projectId }, parent);
    if (type !== row.type) assertChildrenAccept(type, await childrenOf(tx, row.id));

    const [updated] = await tx
      .update(tickets)
      .set({ ...fields, parentId: parent?.id ?? null, updatedAt: deps.clock.now() })
      .where(eq(tickets.id, row.id))
      .returning();
    if (!updated) throw notFound();
    await record({
      projectId: row.projectId,
      ticketId: row.id,
      ticketKey: ticketKeyOf(row),
      kind: "ticket.updated",
      payload: { changes },
    });
    return ticketView(tx, { ...updated, projectKey: row.projectKey });
  });
}

async function findTicketById(db: Db | Tx, id: string) {
  const [row] = await selectTickets(db).where(eq(tickets.id, id));
  if (!row) throw notFound();
  return row;
}

/** Live (not archived) children, oldest first. */
async function childrenOf(db: Db | Tx, ticketId: string) {
  const rows = await selectTickets(db)
    .where(and(eq(tickets.parentId, ticketId), isNull(tickets.archivedAt)))
    .orderBy(asc(tickets.number));
  return rows.map((row) => ({ ...row, key: ticketKeyOf(row) }));
}

export async function listChildren(
  { db }: DomainDeps,
  ctx: CompanyContext,
  key: string,
): Promise<TicketView[]> {
  const ticket = await findTicket(db, ctx, key);
  return ticketViews(db, await childrenOf(db, ticket.id));
}

export async function listTicketActivity(
  { db }: DomainDeps,
  ctx: CompanyContext,
  key: string,
): Promise<ActivityView[]> {
  const ticket = await findTicket(db, ctx, key);
  const rows = await db
    .select()
    .from(activities)
    .where(eq(activities.ticketId, ticket.id))
    .orderBy(asc(activities.id));
  const refs = rows.map((r) => refFromColumns(r.actorUserId, r.actorAgentId) as ActorRef);
  const actor = await resolveActors(db, refs);
  return rows.map((row, i) => ({
    id: row.id,
    projectId: row.projectId,
    ticketId: row.ticketId,
    ticketKey: ticketKeyOf(ticket),
    actor: actor(refs[i] ?? null) as ActorView,
    kind: row.kind,
    payload: row.payload,
    createdAt: row.createdAt,
  }));
}
