import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { api, unwrap } from "./api";
import { authClient } from "./auth-client";

// Query keys that do not belong to one Company. Everything else is cleared when
// the active Company changes, so a board never shows another Company's data.
const sessionWideKeys = ["session", "companies", "auth-providers", "config"];

export const sessionQuery = queryOptions({
  queryKey: ["session"],
  // null means signed out.
  queryFn: async () => (await authClient.getSession()).data?.user ?? null,
  staleTime: Number.POSITIVE_INFINITY,
});

export const companiesQuery = queryOptions({
  queryKey: ["companies"],
  queryFn: () => unwrap(api.companies.$get()),
});

export const authProvidersQuery = queryOptions({
  queryKey: ["auth-providers"],
  queryFn: () => unwrap(api["auth-providers"].$get()),
  staleTime: Number.POSITIVE_INFINITY,
});

/** Public settings of this server. Fetched fresh each time, since sign-up closes after the first User. */
export const configQuery = queryOptions({
  queryKey: ["config"],
  queryFn: () => unwrap(api.config.$get()),
});

export const agentsQuery = queryOptions({
  queryKey: ["agents"],
  queryFn: async () => (await unwrap(api.agents.$get())).agents,
});

export const agentKeysQuery = (agentId: string) =>
  queryOptions({
    queryKey: ["agents", agentId, "keys"],
    queryFn: async () =>
      (await unwrap(api.agents[":agentId"].keys.$get({ param: { agentId } }))).keys,
  });

export function clearCompanyData(queryClient: QueryClient) {
  queryClient.removeQueries({
    predicate: (query) => !sessionWideKeys.includes(String(query.queryKey[0])),
  });
}
