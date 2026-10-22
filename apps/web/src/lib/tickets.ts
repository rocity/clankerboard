import type { CreateTicketInput, TicketPriority, TicketType } from "@clankerboard/shared";
import { type QueryClient, queryOptions, type UseMutationOptions } from "@tanstack/react-query";
import { api, unwrap } from "./api";
import { type TicketData, withoutTicket, withTicket } from "./board";

/**
 * What narrows a Project's board. These are the list endpoint's own query
 * values, so 06-09 can pass typed search params straight through.
 */
export type BoardFilters = {
  type?: TicketType;
  priority?: TicketPriority;
  /** `unassigned`, `agents`, `users`, `user:<id>`, or `agent:<id>`. */
  assignee?: string;
  /** An Epic or Story, to show its direct children. */
  parentKey?: string;
  /** Free text over title and description. */
  q?: string;
};

/** True when the filters hide some of a Project's Tickets. */
export function isFiltered(filters: BoardFilters) {
  return Object.keys(normalize(filters)).length > 0;
}

/** Drops empty values and fixes the key order, so equal filters share one cache entry. */
function normalize(filters: BoardFilters): BoardFilters {
  const entries = Object.entries(filters).filter(
    ([, value]) => value !== undefined && value !== "",
  );
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * Query keys for Tickets. They start with "tickets", which is not session-wide,
 * so switching Company drops them. `board(projectKey)` alone is the prefix of
 * every filtered view of that Project, for cache patches and invalidation.
 */
export const ticketKeys = {
  all: ["tickets"] as const,
  board: (projectKey: string, filters?: BoardFilters) =>
    filters === undefined
      ? (["tickets", "board", projectKey] as const)
      : (["tickets", "board", projectKey, normalize(filters)] as const),
};

const pageSize = 200;

/** Every live Ticket of a Project that matches the filters, following the list's cursor. */
async function loadTickets(projectKey: string, filters: BoardFilters) {
  const tickets: TicketData[] = [];
  let cursor: string | undefined;
  do {
    const page = await unwrap(
      api.tickets.$get({
        query: { projectKey, ...normalize(filters), limit: String(pageSize), cursor },
      }),
    );
    tickets.push(...page.tickets);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return tickets;
}

/** The Tickets of one Project's board, unsorted. Order them with `groupByStatus`. */
export const ticketsQuery = (projectKey: string, filters: BoardFilters = {}) =>
  queryOptions({
    queryKey: ticketKeys.board(projectKey, filters),
    queryFn: () => loadTickets(projectKey, filters),
  });

/** Applies a Ticket snapshot to every cached view of its Project's board. */
export function putTicket(queryClient: QueryClient, ticket: TicketData) {
  queryClient.setQueriesData<TicketData[]>(
    { queryKey: ticketKeys.board(ticket.projectKey) },
    (held) => held && withTicket(held, ticket),
  );
}

/** Drops a Ticket from every cached view of its Project's board. */
export function dropTicket(queryClient: QueryClient, projectKey: string, key: string) {
  queryClient.setQueriesData<TicketData[]>(
    { queryKey: ticketKeys.board(projectKey) },
    (held) => held && withoutTicket(held, key),
  );
}

/** Creates a Ticket. It lands at the bottom of Backlog. */
export function createTicketMutation(
  queryClient: QueryClient,
): UseMutationOptions<TicketData, Error, CreateTicketInput> {
  return {
    mutationFn: async (input) => (await unwrap(api.tickets.$post({ json: input }))).ticket,
    onSuccess: (ticket) => putTicket(queryClient, ticket),
  };
}
