import type { LinkTicketsInput, TicketStatus, UpdateTicketInput } from "@agentkanban/shared";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./api";
import type { TicketData } from "./board";
import { refreshLabels } from "./labels";
import { dropTicket, putTicket, ticketKeys } from "./tickets";

// These three always refetch when the panel opens (the board's 30 second window
// would hide a Comment an Agent added while the panel was closed). Live events
// keep them current while it is open (06-08).

/** One Ticket, by Ticket Key (any letter case). The open Ticket's panel reads this. */
export const ticketQuery = (key: string) =>
  queryOptions({
    queryKey: ticketKeys.detail(key),
    staleTime: 0,
    queryFn: async () => (await unwrap(api.tickets[":key"].$get({ param: { key } }))).ticket,
  });

/** The Ticket's Comments and Activity in one sequence, oldest first. */
export const timelineQuery = (key: string) =>
  queryOptions({
    queryKey: ticketKeys.timeline(key),
    staleTime: 0,
    queryFn: async () =>
      (await unwrap(api.tickets[":key"].timeline.$get({ param: { key } }))).timeline,
  });

export type TimelineEntry = Awaited<
  ReturnType<NonNullable<ReturnType<typeof timelineQuery>["queryFn"]>>
>[number];

/** The Ticket's direct children (archived ones left out). */
export const childrenQuery = (key: string) =>
  queryOptions({
    queryKey: ticketKeys.children(key),
    staleTime: 0,
    queryFn: async () =>
      (await unwrap(api.tickets[":key"].children.$get({ param: { key }, query: {} }))).children,
  });

/**
 * The Ticket's Links as seen from it, grouped blocked by, blocks, relates to,
 * archived counterparts included and marked.
 */
export const linksQuery = (key: string) =>
  queryOptions({
    queryKey: ticketKeys.links(key),
    staleTime: 0,
    queryFn: async () => (await unwrap(api.tickets[":key"].links.$get({ param: { key } }))).links,
  });

export type TicketLinkData = Awaited<
  ReturnType<NonNullable<ReturnType<typeof linksQuery>["queryFn"]>>
>[number];

/**
 * Adds and removes the open Ticket's Links. Each change is Activity on both
 * Tickets and can make this one Blocked or unblocked, so the Links, the
 * Timeline, and the Ticket itself are read again. Refusals (a cycle, an
 * archived Ticket) come back as the error to show.
 */
export function useTicketLinkMutations(ticketKey: string) {
  const queryClient = useQueryClient();
  const param = { key: ticketKey };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ticketKeys.links(ticketKey) });
    void queryClient.invalidateQueries({ queryKey: ticketKeys.timeline(ticketKey) });
    void queryClient.invalidateQueries({ queryKey: ticketKeys.detail(ticketKey) });
  };

  return {
    link: useMutation({
      mutationFn: async (json: LinkTicketsInput) =>
        (await unwrap(api.tickets[":key"].links.$post({ param, json }))).link,
      onSuccess: refresh,
    }),
    unlink: useMutation({
      mutationFn: async (targetKey: string) =>
        unwrap(api.tickets[":key"].links[":targetKey"].$delete({ param: { ...param, targetKey } })),
      onSuccess: refresh,
    }),
  };
}

/** What an Assignee pick sends: an Actor, or null to unassign. */
export type AssigneePick = { type: "user" | "agent"; id: string } | null;

/**
 * Every change to the open Ticket, in one place. None is optimistic: the server
 * answers with the Ticket, which is written to the open Ticket's entry and to
 * every cached board view, and the Timeline is refetched (each change adds
 * Activity). That is one round trip, and what the panel shows is always what
 * the server holds. Rules the server enforces (Parent and Type, Claim conflicts)
 * come back as the error to show.
 */
export function useTicketMutations(ticketKey: string, projectKey: string) {
  const queryClient = useQueryClient();
  const param = { key: ticketKey };

  const applied = (ticket: TicketData) => {
    putTicket(queryClient, ticket);
    void queryClient.invalidateQueries({ queryKey: ticketKeys.timeline(ticketKey) });
  };
  // Archiving detaches children, and restoring or deleting changes what the board holds.
  const settled = (ticket?: TicketData) => {
    if (ticket) applied(ticket);
    void queryClient.invalidateQueries({ queryKey: ticketKeys.board(projectKey) });
    void queryClient.invalidateQueries({ queryKey: ticketKeys.children(ticketKey) });
  };

  return {
    update: useMutation({
      mutationFn: async (json: UpdateTicketInput) =>
        (await unwrap(api.tickets[":key"].$patch({ param, json }))).ticket,
      onSuccess: (ticket, input) => {
        applied(ticket);
        if (input.parentKey !== undefined) {
          void queryClient.invalidateQueries({ queryKey: ticketKeys.children(ticketKey) });
        }
        // A new name created a Label, and every change moves the counts.
        if (input.labels !== undefined) refreshLabels(queryClient);
      },
    }),
    /** Changes the Status. The Ticket goes to the bottom of it. */
    move: useMutation({
      mutationFn: async (status: TicketStatus) =>
        (await unwrap(api.tickets[":key"].move.$post({ param, json: { status } }))).ticket,
      onSuccess: applied,
    }),
    assign: useMutation({
      mutationFn: async (assignee: AssigneePick) =>
        (await unwrap(api.tickets[":key"].assign.$post({ param, json: { assignee } }))).ticket,
      onSuccess: applied,
    }),
    claim: useMutation({
      mutationFn: async () => (await unwrap(api.tickets[":key"].claim.$post({ param }))).ticket,
      onSuccess: applied,
    }),
    archive: useMutation({
      mutationFn: async () => (await unwrap(api.tickets[":key"].archive.$post({ param }))).ticket,
      onSuccess: settled,
    }),
    restore: useMutation({
      mutationFn: async () => (await unwrap(api.tickets[":key"].restore.$post({ param }))).ticket,
      onSuccess: settled,
    }),
    remove: useMutation({
      mutationFn: async () => unwrap(api.tickets[":key"].$delete({ param })),
      onSuccess: () => {
        dropTicket(queryClient, projectKey, ticketKey);
        // Its children were detached. Nothing else of the Ticket is refetched: it is gone.
        void queryClient.invalidateQueries({ queryKey: ticketKeys.board(projectKey) });
      },
    }),
    comment: useMutation({
      mutationFn: async (body: string) =>
        (await unwrap(api.tickets[":key"].comments.$post({ param, json: { body } }))).comment,
      // A Comment is Activity too, but only the Timeline shows it.
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ticketKeys.timeline(ticketKey) }),
    }),
  };
}
