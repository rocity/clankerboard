import type { CompanyRole } from "@clankerboard/shared";

// The Role permission matrix: one function per action, so every adapter (REST
// now, MCP later) asks the same question the same way.

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
