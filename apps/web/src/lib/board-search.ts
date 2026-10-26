import {
  assigneeFilter,
  labelName,
  type TicketPriority,
  type TicketType,
  ticketKey,
  ticketPriority,
  ticketType,
} from "@agentkanban/shared";
import type { BoardFilters } from "./tickets";

/**
 * The filters as they sit in the board's URL: `?assignee=agents&type=bug&type=story&q=login`.
 * Each filter but the search, Blocked, and archived may repeat, and a Ticket
 * matches when it matches any of its values. `assignee` is the list
 * endpoint's value, or `me` for whoever opens the link. `epic` is an Epic's
 * Ticket Key, `team` a Team id, `label` a Label's name, `archived` is on or
 * absent, and `blocked` is `only` or `hide`, as the filter reads, or absent
 * for both.
 */
export type BoardSearch = {
  assignee?: string[];
  type?: TicketType[];
  priority?: TicketPriority[];
  epic?: string[];
  team?: string[];
  label?: string[];
  q?: string;
  archived?: true;
  blocked?: BlockedChoice;
};

/** The filters that take several values. */
export type ListFilter = "assignee" | "type" | "priority" | "epic" | "team" | "label";

export const blockedChoices = ["only", "hide"] as const;
export type BlockedChoice = (typeof blockedChoices)[number];

const maxSearchLength = 200;

/** A search param as text. The router parses `?q=42` into a number, which is still text to us. */
function text(value: unknown) {
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value.trim() : undefined;
}

/**
 * A param given once or repeated, as its valid values without repeats, or
 * undefined when none is valid.
 */
function list<T>(value: unknown, read: (item: string) => T | undefined): T[] | undefined {
  const items = (Array.isArray(value) ? value : [value]).map(text).filter(Boolean) as string[];
  const valid = [...new Set(items.map(read).filter((item) => item !== undefined))];
  return valid.length > 0 ? valid : undefined;
}

const parsed =
  <T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }) =>
  (item: string) => {
    const result = schema.safeParse(item);
    return result.success ? result.data : undefined;
  };

/**
 * Reads the board's search params. A value that is not valid (a typo, an old
 * link, a made-up Status) is dropped, so the board falls back to showing
 * everything for that filter rather than failing.
 */
export function validateBoardSearch(search: Record<string, unknown>): BoardSearch {
  const q = text(search.q)?.slice(0, maxSearchLength);
  const blocked = blockedChoices.find((choice) => choice === text(search.blocked));
  return {
    assignee: list(search.assignee, (item) =>
      item === "me" || assigneeFilter.safeParse(item).success ? item : undefined,
    ),
    type: list(search.type, parsed(ticketType)),
    priority: list(search.priority, parsed(ticketPriority)),
    epic: list(search.epic, (item) => parsed(ticketKey)(item)?.toUpperCase()),
    team: list(search.team, (item) => item),
    label: list(search.label, parsed(labelName)),
    q: q || undefined,
    archived: search.archived === true || search.archived === "true" ? true : undefined,
    blocked,
  };
}

/** The filters to send to the list endpoint. `me` becomes the viewer's own User id. */
export function toBoardFilters(search: BoardSearch, meId: string | undefined): BoardFilters {
  const assignee = search.assignee?.flatMap((value) =>
    value !== "me" ? [value] : meId ? [`user:${meId}`] : [],
  );
  return {
    assignee: assignee?.length ? assignee : undefined,
    type: search.type,
    priority: search.priority,
    parentKey: search.epic,
    teamId: search.team,
    label: search.label,
    q: search.q,
    archived: search.archived ? "include" : undefined,
    blocked: search.blocked && (search.blocked === "only" ? "true" : "false"),
  };
}

/** How many filters are narrowing the board, for the badge on the phone's Filters button. */
export function activeFilterCount(search: BoardSearch) {
  return Object.values(search).filter((value) => value !== undefined).length;
}
