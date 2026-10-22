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

/**
 * Each order's sort, and the rows after a cursor in it. Enums compare in
 * declaration order.
 */
const orders: Record<TicketOrder, { orderBy: SQL[]; afterCursor(after: Cursor): SQL | undefined }> =
  {
    board: {
      orderBy: [asc(tickets.status), asc(tickets.rank), asc(tickets.number), asc(tickets.id)],
      afterCursor: (after) =>
        sql`(${tickets.status}, ${tickets.rank}, ${tickets.number}, ${tickets.id}) > (${after.status}::ticket_status, ${after.rank}, ${after.number}, ${after.id})`,
    },
    urgency: {
      orderBy: [
        asc(tickets.status),
        desc(tickets.priority),
        asc(tickets.rank),
        asc(tickets.number),
        asc(tickets.id),
      ],
      // Priority sorts the other way from the rest, so no single row comparison.
      afterCursor: (after) => {
        const status = sql`${after.status}::ticket_status`;
        const priority = sql`${after.priority}::ticket_priority`;
        const tail = sql`(${tickets.rank}, ${tickets.number}, ${tickets.id}) > (${after.rank}, ${after.number}, ${after.id})`;
        return or(
          sql`${tickets.status} > ${status}`,
          and(
            sql`${tickets.status} = ${status}`,
            or(
              sql`${tickets.priority} < ${priority}`,
              and(sql`${tickets.priority} = ${priority}`, tail),
            ),
          ),
        );
      },
    },
  };

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
        after ? orders[order].afterCursor(after) : undefined,
      ),
    )
    .orderBy(...orders[order].orderBy)
    .limit(filter.limit + 1);

  const page = rows.slice(0, filter.limit);
  const last = page.at(-1);
  return {
    tickets: await ticketViews(db, page),
    nextCursor: rows.length > filter.limit && last ? encodeCursor(order, last) : null,
  };
}
