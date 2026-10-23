import {
  type CreateSprintInput,
  defaultSprintEnd,
  type SprintState,
  type SprintWire,
  type StartSprintInput,
  sprintName,
  type UpdateSprintInput,
  utcDate,
} from "@agentkanban/shared";
import { type QueryClient, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./api";
import type { TicketData } from "./board";
import { putTicket, ticketKeys } from "./tickets";

/** A Sprint as the API sends it: timestamps are ISO strings, `endsOn` is `YYYY-MM-DD`. */
export type SprintData = SprintWire;

/** Query keys for Sprints. They are Company-scoped, so switching Company drops them. */
export const sprintKeys = {
  all: ["sprints"] as const,
  project: (projectKey: string) => ["sprints", projectKey] as const,
};

/** Every Sprint of a Project, by number. */
export const sprintsQuery = (projectKey: string) =>
  queryOptions({
    queryKey: sprintKeys.project(projectKey),
    queryFn: async () =>
      (await unwrap(api.projects[":key"].sprints.$get({ param: { key: projectKey } }))).sprints,
  });

/**
 * How a Project's board shows: every Ticket while it has no Sprints, only the
 * active Sprint's once it has some, or nothing while none is active.
 */
export type SprintMode =
  | { kind: "off" }
  | { kind: "active"; sprint: SprintData }
  | { kind: "idle"; next: SprintData | null };

export function sprintMode(sprints: readonly SprintData[]): SprintMode {
  if (sprints.length === 0) return { kind: "off" };
  const active = sprints.find((s) => s.state === "active");
  if (active) return { kind: "active", sprint: active };
  return { kind: "idle", next: plannedSprints(sprints)[0] ?? null };
}

/** The Planned Sprints, lowest number first: the order a finish picks the next one in. */
export const plannedSprints = (sprints: readonly SprintData[]) =>
  sprints.filter((s) => s.state === "planned").sort((a, b) => a.number - b.number);

/** The Sprints a Ticket can be put in: the active one, then the Planned ones. */
export const openSprints = (sprints: readonly SprintData[]) =>
  [...sprints]
    .filter((s) => s.state !== "finished")
    .sort((a, b) => (a.state === "active" ? -1 : b.state === "active" ? 1 : a.number - b.number));

/** "Sprint 4" as a choice in a select, marked when it is active or finished. */
export const sprintOption = ({ number, state }: { number: number; state: SprintState }) =>
  `${sprintName(number)}${state === "planned" ? "" : ` (${state})`}`;

/** Today in the viewer's own time zone, as `YYYY-MM-DD`. */
export const localToday = (now = new Date()) => now.toLocaleDateString("en-CA");

/** The end date a Sprint started today gets by default, as the server would pick it. */
export function suggestedEnd(sprints: readonly SprintData[], today = localToday()) {
  const last = sprints
    .filter((s) => s.state === "finished" && s.startedAt && s.endsOn && s.finishedAt)
    .sort((a, b) => ((a.finishedAt ?? "") < (b.finishedAt ?? "") ? 1 : -1))[0];
  return defaultSprintEnd(
    today,
    last?.startedAt && last.endsOn
      ? { startedOn: utcDate(new Date(last.startedAt)), endsOn: last.endsOn }
      : null,
  );
}

/** "Nov 6", with the year when it isn't this year. `date` is `YYYY-MM-DD`. */
export function calendarDay(date: string, now = new Date()) {
  const day = new Date(`${date}T00:00:00Z`);
  return day.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: day.getUTCFullYear() === now.getFullYear() ? undefined : "numeric",
    timeZone: "UTC",
  });
}

/** "Ends Nov 6", or "Ended Nov 6" once that day has passed. */
export function endsLabel(endsOn: string, today = localToday()) {
  return `${endsOn < today ? "Ended" : "Ends"} ${calendarDay(endsOn)}`;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * What finishing a Sprint will do, from the board's live Tickets: "2 Done
 * tickets are archived. 3 tickets move to Sprint 5."
 */
export function finishSummary(
  sprint: SprintData,
  sprints: readonly SprintData[],
  tickets: readonly TicketData[],
) {
  const inSprint = tickets.filter((t) => t.sprint?.number === sprint.number && !t.archivedAt);
  const done = inSprint.filter((t) => t.status === "done").length;
  const rest = inSprint.length - done;
  const next = plannedSprints(sprints)[0];
  const parts = [
    ...(done > 0 ? [`${plural(done, "Done ticket")} ${done === 1 ? "is" : "are"} archived.`] : []),
    ...(rest > 0
      ? [
          `${plural(rest, "ticket")} ${rest === 1 ? "moves" : "move"} to ${next ? sprintName(next.number) : "a new sprint"}.`,
        ]
      : []),
  ];
  return parts.join(" ") || "It has no tickets.";
}

/**
 * Refetches what a Sprint change touches: the Project's Sprints, and its
 * board, whose Tickets carry their Sprint's state.
 */
export function refreshSprints(queryClient: QueryClient, projectKey: string) {
  void queryClient.invalidateQueries({ queryKey: sprintKeys.project(projectKey) });
  void queryClient.invalidateQueries({ queryKey: ticketKeys.board(projectKey) });
}

/** Creates, edits, starts, finishes, and deletes a Project's Sprints. Each refetches what it touched. */
export function useSprintMutations(projectKey: string) {
  const queryClient = useQueryClient();
  const refresh = () => refreshSprints(queryClient, projectKey);
  const sprintPath = (number: number) => ({ key: projectKey, number: String(number) });
  return {
    create: useMutation({
      mutationFn: async (json: CreateSprintInput) =>
        (await unwrap(api.projects[":key"].sprints.$post({ param: { key: projectKey }, json })))
          .sprint,
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: async ({ number, ...json }: UpdateSprintInput & { number: number }) =>
        (
          await unwrap(
            api.projects[":key"].sprints[":number"].$patch({ param: sprintPath(number), json }),
          )
        ).sprint,
      onSuccess: refresh,
    }),
    start: useMutation({
      mutationFn: async ({ number, ...json }: StartSprintInput & { number: number }) =>
        (
          await unwrap(
            api.projects[":key"].sprints[":number"].start.$post({
              param: sprintPath(number),
              json,
            }),
          )
        ).sprint,
      onSuccess: refresh,
    }),
    finish: useMutation({
      mutationFn: async (number: number) =>
        unwrap(api.projects[":key"].sprints[":number"].finish.$post({ param: sprintPath(number) })),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (number: number) =>
        unwrap(api.projects[":key"].sprints[":number"].$delete({ param: sprintPath(number) })),
      onSuccess: refresh,
    }),
  };
}

/**
 * Puts one Ticket in a Sprint, or in none, from a list of Tickets. The answer
 * goes into every cached board view, like any change to a Ticket.
 */
export function useSprintPick() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, sprint }: { key: string; sprint: number | null }) =>
      (await unwrap(api.tickets[":key"].$patch({ param: { key }, json: { sprint } }))).ticket,
    onSuccess: (ticket) => {
      putTicket(queryClient, ticket);
      void queryClient.invalidateQueries({ queryKey: ticketKeys.timeline(ticket.key) });
    },
  });
}

/** Ticket count, Done count, and points of a list of Tickets: "3 tickets · 1 done · 8 pts". */
export function sprintTotals(tickets: readonly TicketData[]) {
  const done = tickets.filter((t) => t.status === "done").length;
  const points = tickets.reduce((sum, t) => sum + (t.estimate ?? 0), 0);
  return `${plural(tickets.length, "ticket")} · ${done} done · ${points} pts`;
}
