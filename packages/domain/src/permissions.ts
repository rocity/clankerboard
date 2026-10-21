import type { CompanyRole } from "@clankerboard/shared";
import type { CompanyContext } from "./context";
import { forbidden } from "./errors";

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

/** Owners and admins see every Agent in the Company; everyone else sees their own. */
export function canSeeAllAgents(actor: CompanyRole) {
  return isAdmin(actor);
}

/** The Agent's owner, or an owner or admin, may revoke it or its keys. */
export function canRevokeAgent(actor: CompanyRole, ownsAgent: boolean) {
  return ownsAgent || isAdmin(actor);
}

/** Hard-deleting Projects and Tickets is for owners and admins. */
export function canDeleteBoardContent(actor: CompanyRole) {
  return isAdmin(actor);
}

/** Archiving and restoring are for Users, so every Agent change stays visible on the board. */
export function assertMayArchive(ctx: CompanyContext) {
  if (ctx.actor.type !== "user") throw forbidden("Agents can't archive or restore tickets.");
}

/**
 * The deletion guard. Every service that hard-deletes anything calls this
 * first: deletion is a human-only action, whatever the owner's Role (ADR-0003).
 */
export function assertMayDelete(ctx: CompanyContext) {
  if (ctx.actor.type !== "user") throw forbidden("Agents can't delete anything.");
}
