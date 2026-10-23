import type { CompanyRole } from "./roles";

// The Role permission matrix: one pure function per action over plain Roles, so
// the server (REST now, MCP later) and the web UI ask the same question the same
// way. Checks that need a request or a Project live in packages/domain.

const isAdmin = (role: CompanyRole) => role === "owner" || role === "admin";

export function canUpdateCompany(role: CompanyRole) {
  return isAdmin(role);
}

export function canListMembers(_role: CompanyRole) {
  return true;
}

/** Whether `actor` may move a member from `from` to `to`. Owner changes are owner-only. */
export function canChangeRole(actor: CompanyRole, from: CompanyRole, to: CompanyRole) {
  if (actor === "owner") return true;
  return actor === "admin" && from !== "owner" && to !== "owner";
}

/** Whether `actor` may remove someone else holding `target`. Anyone may leave. */
export function canRemoveMember(actor: CompanyRole, target: CompanyRole) {
  if (actor === "owner") return true;
  return actor === "admin" && target !== "owner";
}

/** Whether `actor` may invite someone as `role`, or resend and revoke such an Invite. */
export function canInvite(actor: CompanyRole, role: CompanyRole) {
  if (actor === "owner") return true;
  return actor === "admin" && role !== "owner";
}

/** Team Invites also let that Team's leads bring people in as plain members. */
export function canInviteToTeam(actor: CompanyRole, role: CompanyRole, isLeadOfTeam: boolean) {
  return canInvite(actor, role) || (isLeadOfTeam && role === "member");
}

/** Owners and admins see every Invite; leads see their own Teams' Invites. */
export function canListInvites(actor: CompanyRole) {
  return isAdmin(actor);
}

export function canManageTeams(actor: CompanyRole) {
  return isAdmin(actor);
}

/** Owners, admins, and a Team's own leads manage who is on that Team. */
export function canManageTeamMembers(actor: CompanyRole, isLeadOfTeam: boolean) {
  return isAdmin(actor) || isLeadOfTeam;
}

export function canSetTeamRole(actor: CompanyRole) {
  return isAdmin(actor);
}

/** Owners and admins see every Agent in the Company; everyone else sees their own. */
export function canSeeAllAgents(actor: CompanyRole) {
  return isAdmin(actor);
}

/** The Agent's owner, or an owner or admin, may revoke it or its keys. */
export function canRevokeAgent(actor: CompanyRole, ownsAgent: boolean) {
  return ownsAgent || isAdmin(actor);
}

/** Renaming, recoloring, and deleting a Label change every Project's board, so they are for owners and admins. */
export function canManageLabels(role: CompanyRole) {
  return isAdmin(role);
}

/** Hard-deleting a Project or Ticket is for owner and admin Users only. */
export function canHardDelete(role: CompanyRole) {
  return isAdmin(role);
}
