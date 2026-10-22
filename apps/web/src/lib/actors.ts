import { queryOptions } from "@tanstack/react-query";
import { api, unwrap } from "./api";

/**
 * Every User and Agent of the Company, by name and kind only (revoked Agents
 * are marked). For assignee pickers and the "specific Actor" filter. Any Role
 * may read it, so a plain member can pick other members' Agents too.
 */
export const actorsQuery = queryOptions({
  queryKey: ["actors"],
  queryFn: async () => (await unwrap(api.actors.$get())).actors,
});
