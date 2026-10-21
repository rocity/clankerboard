import { randomUUID } from "node:crypto";
import { type Db, schema, type Tx } from "@clankerboard/db";
import type {
  AssignTicketInput,
  CreateTicketInput,
  ListTicketsQuery,
  MoveTicketInput,
  TicketPriority,
  TicketStatus,
  TicketType,
  UpdateTicketInput,
} from "@clankerboard/shared";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
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
    if (row.archivedAt) throw conflict("Archived tickets can't be moved.");
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
      .returning(ticketColumns);
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

type Cursor = { status: TicketStatus; rank: string; number: number; id: string };

function encodeCursor(row: TicketRow): string {
  const cursor: Cursor = { status: row.status, rank: row.rank, number: row.number, id: row.id };
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(cursor: string): Cursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Cursor;
    if (
      typeof value.status === "string" &&
      typeof value.rank === "string" &&
      typeof value.number === "number" &&
      typeof value.id === "string"
    ) {
      return value;
    }
  } catch {}
  throw invalid("That page cursor is not valid.");
}

function assigneeCondition(filter: string) {
  if (filter === "unassigned") {
    return and(isNull(tickets.assigneeUserId), isNull(tickets.assigneeAgentId));
  }
  if (filter === "agents") return isNotNull(tickets.assigneeAgentId);
  if (filter === "users") return isNotNull(tickets.assigneeUserId);
  const id = filter.slice(filter.indexOf(":") + 1);
  return filter.startsWith("user:")
    ? eq(tickets.assigneeUserId, id)
    : eq(tickets.assigneeAgentId, id);
}

/**
 * Tickets matching every given filter, in board order (Status column, then
 * rank), one page at a time. Archived Tickets are left out unless asked for.
 */
export async function listTickets(
  { db }: DomainDeps,
  ctx: CompanyContext,
  filter: ListTicketsQuery,
): Promise<{ tickets: TicketView[]; nextCursor: string | null }> {
  const parent = filter.parentKey ? await findTicket(db, ctx, filter.parentKey) : null;
  const after = filter.cursor ? decodeCursor(filter.cursor) : null;
  const rows = await selectTickets(db)
    .where(
      and(
        eq(tickets.companyId, ctx.companyId),
        filter.archived === "exclude" ? isNull(tickets.archivedAt) : undefined,
        filter.archived === "only" ? isNotNull(tickets.archivedAt) : undefined,
        filter.projectKey ? eq(projects.key, filter.projectKey) : undefined,
        filter.status ? eq(tickets.status, filter.status) : undefined,
        filter.type ? eq(tickets.type, filter.type) : undefined,
        filter.priority ? eq(tickets.priority, filter.priority) : undefined,
        filter.assignee ? assigneeCondition(filter.assignee) : undefined,
        parent ? eq(tickets.parentId, parent.id) : undefined,
        filter.teamId ? eq(projects.teamId, filter.teamId) : undefined,
        filter.q
          ? sql`${tickets.search} @@ websearch_to_tsquery('english', ${filter.q})`
          : undefined,
        after
          ? sql`(${tickets.status}, ${tickets.rank}, ${tickets.number}, ${tickets.id}) > (${after.status}::ticket_status, ${after.rank}, ${after.number}, ${after.id})`
          : undefined,
      ),
    )
    .orderBy(asc(tickets.status), asc(tickets.rank), asc(tickets.number), asc(tickets.id))
    .limit(filter.limit + 1);

  const page = rows.slice(0, filter.limit);
  const last = page.at(-1);
  return {
    tickets: await ticketViews(db, page),
    nextCursor: rows.length > filter.limit && last ? encodeCursor(last) : null,
  };
}

export async function createTicket(
  deps: DomainDeps,
  ctx: CompanyContext,
  input: CreateTicketInput,
): Promise<TicketView> {
  const now = deps.clock.now();
  return withActivity(deps, ctx, async (tx, record) => {
    const project = await findProject(tx, ctx, input.projectKey);
    const parent = input.parentKey ? await findParent(tx, ctx, input.parentKey) : null;
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
      .returning(ticketColumns);
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
          : await findParent(tx, ctx, parentKey);
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
      .returning(ticketColumns);
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

export async function findTicketById(db: Db | Tx, id: string) {
  const [row] = await selectTickets(db).where(eq(tickets.id, id));
  if (!row) throw notFound();
  return row;
}

/**
 * Children, oldest first. Archived ones count for the hierarchy rules, since
 * an archived child keeps its Parent and can be restored under it.
 */
async function childrenOf(db: Db | Tx, ticketId: string, { includeArchived = true } = {}) {
  const rows = await selectTickets(db)
    .where(
      and(eq(tickets.parentId, ticketId), includeArchived ? undefined : isNull(tickets.archivedAt)),
    )
    .orderBy(asc(tickets.number));
  return rows.map((row) => ({ ...row, key: ticketKeyOf(row) }));
}

/** A Ticket's children. Archived ones are left out unless asked for. */
export async function listChildren(
  { db }: DomainDeps,
  ctx: CompanyContext,
  key: string,
  { includeArchived = false } = {},
): Promise<TicketView[]> {
  const ticket = await findTicket(db, ctx, key);
  return ticketViews(db, await childrenOf(db, ticket.id, { includeArchived }));
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

/** A Parent to set, by key: in this Company and not archived. */
async function findParent(tx: Db | Tx, ctx: CompanyContext, key: string) {
  const parent = await findTicket(tx, ctx, key);
  if (parent.archivedAt) {
    throw invalid(`Restore ${ticketKeyOf(parent)} before adding tickets under it.`);
  }
  return parent;
}

/** Throws unless `ref` is an Actor who can hold work in this Company right now. */
async function assertAssignable(tx: Db | Tx, ctx: CompanyContext, ref: ActorRef) {
  const { memberships, agents } = schema;
  if (ref.type === "user") {
    const [member] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.companyId, ctx.companyId), eq(memberships.userId, ref.id)));
    if (!member) throw notFound();
    return;
  }
  const [agent] = await tx
    .select({ revokedAt: agents.revokedAt, ownerRole: memberships.role })
    .from(agents)
    .leftJoin(
      memberships,
      and(eq(memberships.companyId, agents.companyId), eq(memberships.userId, agents.ownerUserId)),
    )
    .where(and(eq(agents.id, ref.id), eq(agents.companyId, ctx.companyId)));
  if (!agent) throw notFound();
  if (agent.revokedAt || !agent.ownerRole) throw invalid("That agent was revoked.");
}

export async function assignTicket(
  deps: DomainDeps,
  ctx: CompanyContext,
  key: string,
  input: AssignTicketInput,
): Promise<TicketView> {
  return withActivity(deps, ctx, async (tx, record) => {
    const row = await findTicket(tx, ctx, key, true);
    if (row.archivedAt) throw conflict("Archived tickets can't be assigned.");
    const to = input.assignee;
    if (to) await assertAssignable(tx, ctx, to);
    const from = refFromColumns(row.assigneeUserId, row.assigneeAgentId);
    if (from?.type === to?.type && from?.id === to?.id) return ticketView(tx, row);

    const columns = actorColumns(to);
    const [updated] = await tx
      .update(tickets)
      .set({
        assigneeUserId: columns.userId,
        assigneeAgentId: columns.agentId,
        updatedAt: deps.clock.now(),
      })
      .where(eq(tickets.id, row.id))
      .returning(ticketColumns);
    if (!updated) throw notFound();
    await record({
      projectId: row.projectId,
      ticketId: row.id,
      ticketKey: ticketKeyOf(row),
      kind: "ticket.assigned",
      payload: { from, to },
    });
    return ticketView(tx, { ...updated, projectKey: row.projectKey });
  });
}

/**
 * Makes the caller the Assignee and moves the Ticket to the bottom of In
 * Progress, in one conditional update that only succeeds while nobody holds
 * it. Of two concurrent Claims, exactly one wins.
 */
export async function claimTicket(
  deps: DomainDeps,
  ctx: CompanyContext,
  key: string,
): Promise<TicketView> {
  return withActivity(deps, ctx, async (tx, record) => {
    const row = await findTicket(tx, ctx, key);
    const rank = await bottomRank(tx, row.projectId, "in_progress");
    const claimant = actorColumns(refOf(ctx.actor));

    const [claimed] = await tx
      .update(tickets)
      .set({
        assigneeUserId: claimant.userId,
        assigneeAgentId: claimant.agentId,
        status: "in_progress",
        rank,
        updatedAt: deps.clock.now(),
      })
      .where(
        and(
          eq(tickets.id, row.id),
          isNull(tickets.assigneeUserId),
          isNull(tickets.assigneeAgentId),
          isNull(tickets.archivedAt),
          ne(tickets.status, "done"),
        ),
      )
      .returning(ticketColumns);

    if (!claimed) {
      const current = await findTicketById(tx, row.id);
      if (current.archivedAt) throw conflict("Archived tickets can't be claimed.");
      const holder = await ticketView(tx, current);
      if (holder.assignee) {
        throw conflict(`${holder.key} is already held by ${holder.assignee.name}.`, {
          assignee: holder.assignee,
        });
      }
      throw conflict("Done tickets can't be claimed.");
    }

    await record({
      projectId: row.projectId,
      ticketId: row.id,
      ticketKey: ticketKeyOf(row),
      kind: "ticket.claimed",
      payload: {
        from: { status: row.status, rank: row.rank },
        to: { status: "in_progress", rank },
      },
    });
    return ticketView(tx, { ...claimed, projectKey: row.projectKey });
  });
}
