import type { Db, Tx } from "@agentkanban/db";
import { type MoveTicketInput, statusLabels, type TicketStatus } from "@agentkanban/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { withActivity } from "./activity";
import type { CompanyContext, DomainDeps } from "./context";
import { conflict, invalid } from "./errors";
import { rankAt } from "./rank";
import {
  findTicket,
  saveTicket,
  selectTickets,
  type TicketView,
  ticketActivity,
  ticketKeyOf,
  tickets,
} from "./ticket-store";

/** A Project's Tickets in one Status, in rank order, leaving out one Ticket. */
async function ticketsInStatus(
  tx: Db | Tx,
  projectId: string,
  status: TicketStatus,
  without: string,
) {
  const rows = await selectTickets(tx)
    .where(
      and(eq(tickets.projectId, projectId), eq(tickets.status, status), isNull(tickets.archivedAt)),
    )
    .orderBy(asc(tickets.rank), asc(tickets.number));
  return rows.filter((row) => row.id !== without).map((row) => ({ ...row, key: ticketKeyOf(row) }));
}

/** Where among `siblings` the moved Ticket goes, from its neighbours or a position. */
function placeIn(siblings: { key: string }[], status: TicketStatus, input: MoveTicketInput) {
  const indexOf = (key: string) => {
    const index = siblings.findIndex((row) => row.key === key.toUpperCase());
    if (index === -1) throw invalid(`${key.toUpperCase()} isn't in ${statusLabels[status]}.`);
    return index;
  };
  if (input.after) {
    const index = indexOf(input.after) + 1;
    if (input.before && siblings[index]?.key !== input.before.toUpperCase()) {
      throw conflict("Those tickets are no longer next to each other. Refresh and try again.");
    }
    return index;
  }
  if (input.before) return indexOf(input.before);
  return Math.min(input.position ?? siblings.length, siblings.length);
}

/** Moves a Ticket to a Status and a place among its Tickets, updating that one row only. */
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
    const siblings = await ticketsInStatus(tx, row.projectId, status, row.id);
    const rank = rankAt(
      siblings.map((r) => r.rank),
      placeIn(siblings, status, input),
    );

    const view = await saveTicket(tx, row, { status, rank, updatedAt: deps.clock.now() });
    await record(
      ticketActivity(row, "ticket.moved", {
        from: { status: row.status, rank: row.rank },
        to: { status, rank },
      }),
    );
    return view;
  });
}
