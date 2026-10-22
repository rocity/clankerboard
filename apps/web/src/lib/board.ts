import { type TicketStatus, type TicketWire, ticketStatuses } from "@clankerboard/shared";

/**
 * A Ticket as the API sends it: timestamps are ISO strings. Everything on the
 * board, the cards, the query cache, and the live stream's snapshots, uses
 * this one shape.
 */
export type TicketData = TicketWire;

const statusIndex: Record<TicketStatus, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  review: 3,
  done: 4,
};

/**
 * The one place that orders Tickets on the board: by Status, then rank, then
 * number. Ranks are fractional-index keys that sort by byte order (ADR-0008),
 * so they are compared with plain `<`, never `localeCompare`, which would put
 * "a0" before "Zz".
 */
export function compareTickets(a: TicketData, b: TicketData) {
  return (
    statusIndex[a.status] - statusIndex[b.status] ||
    (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0) ||
    a.number - b.number
  );
}

export type TicketsByStatus = Record<TicketStatus, TicketData[]>;

/** Every Status with its Tickets in board order. A Status without Tickets gets an empty list. */
export function groupByStatus(tickets: readonly TicketData[]): TicketsByStatus {
  const groups = Object.fromEntries(
    ticketStatuses.map((s) => [s, [] as TicketData[]]),
  ) as TicketsByStatus;
  for (const ticket of [...tickets].sort(compareTickets)) groups[ticket.status].push(ticket);
  return groups;
}

/**
 * The Ticket list after one Ticket changed: replaces the entry with the same
 * key, or adds it. An archived Ticket leaves the board. A snapshot older than
 * the one already held is ignored, so a late echo cannot undo a newer change.
 */
export function withTicket(tickets: readonly TicketData[], ticket: TicketData): TicketData[] {
  const without = tickets.filter((t) => t.key !== ticket.key);
  const held = tickets.find((t) => t.key === ticket.key);
  if (held && held.updatedAt > ticket.updatedAt) return [...tickets];
  if (ticket.archivedAt) return without;
  return [...without, ticket];
}

/** The Ticket list without the Ticket with this key. */
export function withoutTicket(tickets: readonly TicketData[], key: string): TicketData[] {
  return tickets.filter((t) => t.key !== key);
}
