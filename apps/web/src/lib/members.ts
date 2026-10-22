import { type CompanyRole, companyRoles } from "@agentkanban/shared";
import { queryOptions } from "@tanstack/react-query";
import { api, unwrap } from "./api";

// Company-scoped keys: cleared when the active Company changes (see queries.ts).
export const membersQuery = queryOptions({
  queryKey: ["members"],
  queryFn: async () => (await unwrap(api.members.$get())).members,
});

export const invitesQuery = queryOptions({
  queryKey: ["invites"],
  queryFn: async () => (await unwrap(api.invites.$get())).invites,
});

const roleLabels: Record<CompanyRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export function roleLabel(role: CompanyRole) {
  return roleLabels[role];
}

/** The Roles `allowed` accepts, most powerful first. */
export function rolesWhere(allowed: (role: CompanyRole) => boolean): CompanyRole[] {
  return companyRoles.filter(allowed);
}
