import { queryOptions } from "@tanstack/react-query";
import { api, unwrap } from "./api";

/** Query keys for Projects. They are Company-scoped, so switching Company drops them. */
export const projectKeys = {
  all: ["projects"] as const,
  list: (teamId: string | null) => ["projects", "list", teamId] as const,
  detail: (key: string) => ["projects", "detail", key] as const,
};

/** The Company's Projects, optionally only those of one Team. */
export const projectsQuery = (teamId: string | null) =>
  queryOptions({
    queryKey: projectKeys.list(teamId),
    queryFn: async () =>
      (await unwrap(api.projects.$get({ query: teamId ? { teamId } : {} }))).projects,
  });

export const projectQuery = (key: string) =>
  queryOptions({
    queryKey: projectKeys.detail(key),
    queryFn: async () => (await unwrap(api.projects[":key"].$get({ param: { key } }))).project,
  });

/** The Company's Teams, for the Team filter and the Project dialog. */
export const teamsQuery = queryOptions({
  queryKey: ["teams"],
  queryFn: async () => (await unwrap(api.teams.$get())).teams,
});
