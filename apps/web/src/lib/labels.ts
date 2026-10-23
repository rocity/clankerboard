import type { LabelColor, UpdateLabelInput } from "@agentkanban/shared";
import { type QueryClient, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./api";
import { ticketKeys } from "./tickets";

export const labelKeys = { all: ["labels"] as const };

/**
 * Every Label of the Company, in name order, with how many live Tickets carry
 * each. Suggestions, the board's Label filter, and the Labels page read it.
 */
export const labelsQuery = queryOptions({
  queryKey: labelKeys.all,
  queryFn: async () => (await unwrap(api.labels.$get())).labels,
});

export type LabelData = Awaited<ReturnType<NonNullable<(typeof labelsQuery)["queryFn"]>>>[number];

/** Reads the Company's Labels again, after a change that may have created or counted one. */
export function refreshLabels(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: labelKeys.all });
}

/**
 * Tailwind classes for each Label color: the dot, and the chip's tint. Written
 * out in full, since Tailwind only keeps class names it finds whole in source.
 */
export const labelColorClasses: Record<LabelColor, { dot: string; chip: string }> = {
  gray: {
    dot: "bg-zinc-500 dark:bg-zinc-400",
    chip: "bg-zinc-500/15 text-zinc-800 dark:bg-zinc-400/20 dark:text-zinc-100",
  },
  red: {
    dot: "bg-red-500 dark:bg-red-400",
    chip: "bg-red-500/15 text-red-800 dark:bg-red-400/20 dark:text-red-100",
  },
  orange: {
    dot: "bg-orange-500 dark:bg-orange-400",
    chip: "bg-orange-500/15 text-orange-800 dark:bg-orange-400/20 dark:text-orange-100",
  },
  amber: {
    dot: "bg-amber-500 dark:bg-amber-400",
    chip: "bg-amber-500/15 text-amber-800 dark:bg-amber-400/20 dark:text-amber-100",
  },
  green: {
    dot: "bg-green-600 dark:bg-green-400",
    chip: "bg-green-600/15 text-green-800 dark:bg-green-400/20 dark:text-green-100",
  },
  teal: {
    dot: "bg-teal-600 dark:bg-teal-400",
    chip: "bg-teal-600/15 text-teal-800 dark:bg-teal-400/20 dark:text-teal-100",
  },
  blue: {
    dot: "bg-blue-600 dark:bg-blue-400",
    chip: "bg-blue-600/15 text-blue-800 dark:bg-blue-400/20 dark:text-blue-100",
  },
  violet: {
    dot: "bg-violet-600 dark:bg-violet-400",
    chip: "bg-violet-600/15 text-violet-800 dark:bg-violet-400/20 dark:text-violet-100",
  },
  pink: {
    dot: "bg-pink-600 dark:bg-pink-400",
    chip: "bg-pink-600/15 text-pink-800 dark:bg-pink-400/20 dark:text-pink-100",
  },
};

/**
 * Renames, recolors, and deletes Labels, for owners and admins. Each changes
 * how every Ticket carrying the Label reads, and a rename or recolor sends no
 * live event, so this User's cached boards and open Ticket are read again.
 */
export function useLabelMutations() {
  const queryClient = useQueryClient();
  const refresh = () => {
    refreshLabels(queryClient);
    void queryClient.invalidateQueries({ queryKey: ticketKeys.all });
  };
  return {
    update: useMutation({
      mutationFn: async ({ id, ...json }: UpdateLabelInput & { id: string }) =>
        (await unwrap(api.labels[":id"].$patch({ param: { id }, json }))).label,
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => unwrap(api.labels[":id"].$delete({ param: { id } })),
      onSuccess: refresh,
    }),
  };
}
