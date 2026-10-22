import type { CreateTicketInput, TicketPriority, TicketType } from "@agentkanban/shared";
import { type QueryClient, queryOptions, type UseMutationOptions } from "@tanstack/react-query";
import { api, unwrap } from "./api";
import { type TicketData, withoutTicket, withTicket } from "./board";
import { projectKeys } from "./projects";

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
  /** Only Projects of this Team. On one Project's board that is all of it or none of it. */
  teamId?: string;
  /** `include` adds archived Tickets to the live ones. The list has no archived-only filter. */
  archived?: "include";
  /** `true` for only Blocked Tickets, `false` for only unblocked ones. */
  blocked?: "true" | "false";
};

/** What a Ticket cannot say about itself: the Team of its Project, when known. */
export type FilterContext = {
  /** `null` is a Project without a Team. Leave it out when unknown, so a Team filter passes. */
  projectTeamId?: string | null;
};

/**
 * Whether a Ticket belongs in a view narrowed by `filters`, with the same
 * meaning as the list endpoint, so a cached view can take a Ticket snapshot
 * without a refetch. Archived Tickets only match when `archived` is `include`.
 *
 * It cannot judge `q`: the server matches word stems in the title and
 * description, which the browser does not reproduce. `q` is ignored here, and
 * `hasSearch` tells callers to ask the server instead.
 */
export function ticketMatchesFilters(
  ticket: TicketData,
  filters: BoardFilters,
  { projectTeamId }: FilterContext = {},
) {
  if (ticket.archivedAt && filters.archived !== "include") return false;
  if (filters.type && ticket.type !== filters.type) return false;
  if (filters.priority && ticket.priority !== filters.priority) return false;
  if (filters.assignee && !assigneeMatches(ticket.assignee, filters.assignee)) return false;
  if (filters.parentKey && ticket.parent?.key !== filters.parentKey.toUpperCase()) return false;
  if (filters.blocked && String(ticket.blocked) !== filters.blocked) return false;
  if (filters.teamId && projectTeamId !== undefined && projectTeamId !== filters.teamId) {
    return false;
  }
  return true;
}

/** True when the filters include a text search, which only the server can judge. */
export const hasSearch = (filters: BoardFilters) => Boolean(filters.q);

function assigneeMatches(assignee: TicketData["assignee"], wanted: string) {
  if (wanted === "unassigned") return assignee === null;
  if (wanted === "agents") return assignee?.type === "agent";
  if (wanted === "users") return assignee?.type === "user";
  return assignee !== null && `${assignee.type}:${assignee.id}` === wanted;
}

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
  // The open Ticket and what hangs off it. Each is its own key, not a prefix of
  // another, so `setQueryData` on one never touches the others (06-08 patches
  // `detail` from a snapshot and refetches `timeline` on `comment.added`).
  detail: (key: string) => ["tickets", "detail", key] as const,
  timeline: (key: string) => ["tickets", "timeline", key] as const,
  children: (key: string) => ["tickets", "children", key] as const,
  links: (key: string) => ["tickets", "links", key] as const,
  /** Every live Ticket of the Company, for picking the other Ticket of a new Ticket Link. */
  company: ["tickets", "company"] as const,
};

const pageSize = 200;

/**
 * Every live Ticket that matches the filters, following the list's cursor. With
 * no Project Key, that is every Project of the Company.
 */
async function loadTickets(projectKey: string | undefined, filters: BoardFilters) {
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

/** Every live Ticket of the Company, in every Project. Read when a Ticket Link is being added. */
export const companyTicketsQuery = queryOptions({
  queryKey: ticketKeys.company,
  queryFn: () => loadTickets(undefined, {}),
});

/**
 * Applies a Ticket snapshot to every cached view of its Project's board. A view
 * takes the Ticket only if it matches that view's filters and drops it
 * otherwise, so a filtered board never shows a Ticket it should not. A view with
 * a text search is refetched instead, since only the server can judge it. The
 * open Ticket's own entry takes the snapshot too, unless it holds a newer one.
 */
export function putTicket(queryClient: QueryClient, ticket: TicketData) {
  const project = queryClient.getQueryData<{ team: { id: string } | null }>(
    projectKeys.detail(ticket.projectKey),
  );
  queryClient.setQueryData<TicketData>(
    ticketKeys.detail(ticket.key),
    (held) => held && (held.updatedAt > ticket.updatedAt ? held : ticket),
  );
  const context: FilterContext = {
    projectTeamId: project ? (project.team?.id ?? null) : undefined,
  };
  for (const query of queryClient.getQueryCache().findAll({
    queryKey: ticketKeys.board(ticket.projectKey),
  })) {
    const filters = (query.queryKey[3] ?? {}) as BoardFilters;
    if (hasSearch(filters)) {
      queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
      continue;
    }
    queryClient.setQueryData<TicketData[]>(
      query.queryKey,
      (held) => held && withTicket(held, ticket, ticketMatchesFilters(ticket, filters, context)),
    );
  }
}

/** Restores an archived Ticket. It returns to the live board where it was. */
export function restoreTicketMutation(
  queryClient: QueryClient,
): UseMutationOptions<TicketData, Error, string> {
  return {
    mutationFn: async (key) =>
      (await unwrap(api.tickets[":key"].restore.$post({ param: { key } }))).ticket,
    onSuccess: (ticket) => putTicket(queryClient, ticket),
  };
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
