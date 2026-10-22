import type { TeamRole } from "@clankerboard/shared";
import { queryOptions } from "@tanstack/react-query";
import { api, unwrap } from "./api";

export { teamsQuery } from "./projects";

/**
 * One Team with its members. Always refetched on a visit: leads and admins change who is on a
 * Team from other tabs and other screens, and the controls depend on it.
 */
export const teamQuery = (teamId: string) =>
  queryOptions({
    // Starts with "teams", so invalidating ["teams"] refreshes the list and every Team page.
    queryKey: ["teams", "detail", teamId],
    queryFn: () => unwrap(api.teams[":teamId"].$get({ param: { teamId } })),
    staleTime: 0,
  });

const teamRoleLabels: Record<TeamRole, string> = { lead: "Lead", member: "Member" };

export const teamRoleLabel = (role: TeamRole) => teamRoleLabels[role];

export const memberCountLabel = (count: number) => `${count} ${count === 1 ? "member" : "members"}`;
