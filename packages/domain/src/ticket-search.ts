import type {
  AssigneeFilter,
  ListTicketsQuery,
  TicketPriority,
  TicketStatus,
} from "@clankerboard/shared";
import { and, asc, desc, eq, gte, isNotNull, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import type { CompanyContext, DomainDeps } from "./context";
import { invalid } from "./errors";
import {
  findTicket,
  projects,
  selectTickets,
  type TicketRow,
  type TicketView,
  tickets,
  ticketViews,
} from "./ticket-store";

/**
 * `board` is the order people see: by Status, then rank. `urgency` puts the
 * most urgent first within each Status, then rank, for agents picking work.
 */
export type TicketOrder = "board" | "urgency";

export type ListTicketsOptions = {
  order?: TicketOrder;
  /** Leaves out Done Tickets last changed before this time. */
  doneSince?: Date;
};

type Cursor = {
  order: TicketOrder;
  status: TicketStatus;
  priority: TicketPriority;
  rank: string;
  number: number;
  id: string;
};

function encodeCursor(order: TicketOrder, row: TicketRow): string {
  const { status, priority, rank, number, id } = row;
  const cursor: Cursor = { order, status, priority, rank, number, id };
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(order: TicketOrder, cursor: string): Cursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Cursor;
    if (
      value.order === order &&
      typeof value.status === "string" &&
      typeof value.priority === "string" &&
      typeof value.rank === "string" &&
      typeof value.number === "number" &&
      typeof value.id === "string"
    ) {
      return value;
    }
  } catch {}
  throw invalid("That page cursor is not valid.");
}

/** Rows after the cursor, in the given order. Enums compare in declaration order. */
function afterCursor(order: TicketOrder, after: Cursor): SQL | undefined {
  const tail = sql`(${tickets.rank}, ${tickets.number}, ${tickets.id}) > (${after.rank}, ${after.number}, ${after.id})`;
  const status = sql`${after.status}::ticket_status`;
  if (order === "board") {
    return sql`(${tickets.status}, ${tickets.rank}, ${tickets.number}, ${tickets.id}) > (${status}, ${after.rank}, ${after.number}, ${after.id})`;
  }
  const priority = sql`${after.priority}::ticket_priority`;
  return or(
    sql`${tickets.status} > ${status}`,
    and(
      sql`${tickets.status} = ${status}`,
      or(sql`${tickets.priority} < ${priority}`, and(sql`${tickets.priority} = ${priority}`, tail)),
    ),
  );
}

function assigneeCondition(filter: AssigneeFilter) {
  switch (filter.kind) {
    case "unassigned":
      return and(isNull(tickets.assigneeUserId), isNull(tickets.assigneeAgentId));
    case "agents":
      return isNotNull(tickets.assigneeAgentId);
    case "users":
      return isNotNull(tickets.assigneeUserId);
    case "actor":
      return filter.actor.type === "user"
        ? eq(tickets.assigneeUserId, filter.actor.id)
        : eq(tickets.assigneeAgentId, filter.actor.id);
  }
}

/**
 * Tickets matching every given filter, in board order (by Status, then
 * rank) unless asked for `urgency`, one page at a time. Archived Tickets are
 * left out unless asked for. A cursor only continues a list in its own order.
 */
export async function listTickets(
  { db }: DomainDeps,
  ctx: CompanyContext,
  filter: ListTicketsQuery,
  { order = "board", doneSince }: ListTicketsOptions = {},
): Promise<{ tickets: TicketView[]; nextCursor: string | null }> {
  const parent = filter.parentKey ? await findTicket(db, ctx, filter.parentKey) : null;
  const after = filter.cursor ? decodeCursor(order, filter.cursor) : null;
  const rows = await selectTickets(db)
    .where(
      and(
        eq(tickets.companyId, ctx.companyId),
        filter.archived === "exclude" ? isNull(tickets.archivedAt) : undefined,
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
        doneSince ? or(ne(tickets.status, "done"), gte(tickets.updatedAt, doneSince)) : undefined,
        after ? afterCursor(order, after) : undefined,
      ),
    )
    .orderBy(
      asc(tickets.status),
      ...(order === "urgency" ? [desc(tickets.priority)] : []),
      asc(tickets.rank),
      asc(tickets.number),
      asc(tickets.id),
    )
    .limit(filter.limit + 1);

  const page = rows.slice(0, filter.limit);
  const last = page.at(-1);
  return {
    tickets: await ticketViews(db, page),
    nextCursor: rows.length > filter.limit && last ? encodeCursor(order, last) : null,
  };
}
