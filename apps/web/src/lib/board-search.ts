import {
  assigneeFilter,
  type TicketPriority,
  type TicketType,
  ticketKey,
  ticketPriority,
  ticketType,
} from "@agentkanban/shared";
import type { BoardFilters } from "./tickets";

/**
 * The filters as they sit in the board's URL: `?assignee=agents&type=bug&q=login`.
 * `assignee` is the list endpoint's value, or `me` for whoever opens the link.
 * `epic` is an Epic's Ticket Key, `team` a Team id, `archived` is on or absent,
 * and `blocked` is `only` or `hide`, as the filter reads, or absent for both.
 */
export type BoardSearch = {
  assignee?: string;
  type?: TicketType;
  priority?: TicketPriority;
  epic?: string;
  team?: string;
  q?: string;
  archived?: true;
  blocked?: BlockedChoice;
};

export const blockedChoices = ["only", "hide"] as const;
export type BlockedChoice = (typeof blockedChoices)[number];

const maxSearchLength = 200;

/** A search param as text. The router parses `?q=42` into a number, which is still text to us. */
function text(value: unknown) {
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value.trim() : undefined;
}

/**
 * Reads the board's search params. A value that is not valid (a typo, an old
 * link, a made-up Status) is dropped, so the board falls back to showing
 * everything for that filter rather than failing.
 */
export function validateBoardSearch(search: Record<string, unknown>): BoardSearch {
  const assignee = text(search.assignee);
  const type = ticketType.safeParse(text(search.type));
  const priority = ticketPriority.safeParse(text(search.priority));
  const epic = ticketKey.safeParse(text(search.epic));
  const q = text(search.q)?.slice(0, maxSearchLength);
  const blocked = blockedChoices.find((choice) => choice === text(search.blocked));
  return {
    assignee:
      assignee && (assignee === "me" || assigneeFilter.safeParse(assignee).success)
        ? assignee
        : undefined,
    type: type.success ? type.data : undefined,
    priority: priority.success ? priority.data : undefined,
    epic: epic.success ? epic.data.toUpperCase() : undefined,
    team: text(search.team) || undefined,
    q: q || undefined,
    archived: search.archived === true || search.archived === "true" ? true : undefined,
    blocked,
  };
}

/** The filters to send to the list endpoint. `me` becomes the viewer's own User id. */
export function toBoardFilters(search: BoardSearch, meId: string | undefined): BoardFilters {
  const assignee = search.assignee === "me" ? (meId ? `user:${meId}` : undefined) : search.assignee;
  return {
    assignee,
    type: search.type,
    priority: search.priority,
    parentKey: search.epic,
    teamId: search.team,
    q: search.q,
    archived: search.archived ? "include" : undefined,
    blocked: search.blocked && (search.blocked === "only" ? "true" : "false"),
  };
}

/** How many filters are narrowing the board, for the badge on the phone's Filters button. */
export function activeFilterCount(search: BoardSearch) {
  return Object.values(search).filter((value) => value !== undefined).length;
}
