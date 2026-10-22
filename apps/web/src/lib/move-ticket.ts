import { rankAt, type TicketStatus } from "@clankerboard/shared";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage, unwrap } from "./api";
import type { TicketData } from "./board";
import { putTicket, ticketKeys } from "./tickets";

/**
 * Where a Ticket is dropped: a Status and the Tickets it lands between. The
 * neighbours are the ones next to it in the Status, without the moved Ticket,
 * as the person sees them.
 */
export type Placement = {
  status: TicketStatus;
  after: TicketData | null;
  before: TicketData | null;
};

export type MoveOptions = {
  /**
   * True when the board hides some Tickets. A hidden Ticket may sit between two
   * visible neighbours, so only one of them is sent: the server refuses a pair
   * that is not adjacent.
   */
  filtered?: boolean;
};

/** The keys of Tickets whose move request has not been answered yet. */
const moving = new Set<string>();

/**
 * True while a move of this Ticket is waiting for the server. The live stream
 * (06-08) applies a snapshot of that Ticket with `putTicket` as usual: the
 * optimistic copy keeps the old `updatedAt`, so any snapshot from the server
 * replaces it, and the one that echoes the move lands exactly where the copy
 * already sits.
 */
export function isMoving(key: string) {
  return moving.has(key);
}

/** The request body: the Status and the neighbours the server needs to rank the Ticket. */
export function moveRequest({ status, after, before }: Placement, options: MoveOptions = {}) {
  if (options.filtered) {
    return after
      ? { status, after: after.key }
      : before
        ? { status, before: before.key }
        : { status };
  }
  return {
    status,
    ...(after && { after: after.key }),
    ...(before && { before: before.key }),
  };
}

/** The Ticket as the board shows it right after the drop: new Status, a rank between its neighbours. */
export function movedTicket(ticket: TicketData, placement: Placement): TicketData {
  const ranks: string[] = [];
  if (placement.after) ranks.push(placement.after.rank);
  if (placement.before) ranks.push(placement.before.rank);
  const rank = rankAt(ranks, placement.after ? 1 : 0);
  // `updatedAt` stays, so a snapshot from the server always replaces this copy.
  return { ...ticket, status: placement.status, rank };
}

/** Replaces one Ticket in every cached view of its Project's board, where it is held. */
function patchTicket(
  queryClient: QueryClient,
  projectKey: string,
  key: string,
  change: (held: TicketData) => TicketData,
) {
  queryClient.setQueriesData<TicketData[]>({ queryKey: ticketKeys.board(projectKey) }, (held) =>
    held?.some((t) => t.key === key) ? held.map((t) => (t.key === key ? change(t) : t)) : held,
  );
}

/**
 * Moves a Ticket the way a drop does: the cache shows the new place at once, the
 * server is asked with the neighbours, its answer replaces the guess, and a
 * refusal puts the Ticket back and says why in a toast. It resolves either way.
 */
export async function moveTicket(
  queryClient: QueryClient,
  ticket: TicketData,
  placement: Placement,
  options: MoveOptions = {},
) {
  const board = ticketKeys.board(ticket.projectKey);
  // A fetch that started before the drop would overwrite the guess with old data.
  if (queryClient.isFetching({ queryKey: board }) > 0) {
    await queryClient.cancelQueries({ queryKey: board });
  }
  const guess = movedTicket(ticket, placement);
  patchTicket(queryClient, ticket.projectKey, ticket.key, () => guess);
  moving.add(ticket.key);

  try {
    const { ticket: saved } = await unwrap(
      api.tickets[":key"].move.$post({
        param: { key: ticket.key },
        json: moveRequest(placement, options),
      }),
    );
    putTicket(queryClient, saved);
  } catch (error) {
    // Put the Ticket back, unless something newer has already changed it.
    patchTicket(queryClient, ticket.projectKey, ticket.key, (held) =>
      held.status === guess.status && held.rank === guess.rank ? ticket : held,
    );
    toast.error(`${ticket.key} did not move.`, { description: errorMessage(error) });
    // The refusal may mean the board is out of date.
    void queryClient.invalidateQueries({ queryKey: board });
  } finally {
    moving.delete(ticket.key);
  }
}
