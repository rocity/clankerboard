import type { AssigneeFilter, ListTicketsQuery, TicketStatus } from "@clankerboard/shared";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
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
