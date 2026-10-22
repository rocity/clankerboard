import { canHardDelete } from "@clankerboard/shared";
import type { CompanyContext } from "./context";
import { forbidden } from "./errors";

// The Role matrix itself lives in packages/shared, so the web UI asks the same
// questions. This module adds the checks that need a request or a Project.
export {
  canChangeRole,
  canHardDelete,
  canInvite,
  canInviteToTeam,
  canListInvites,
  canListMembers,
  canManageTeamMembers,
  canManageTeams,
  canRemoveMember,
  canRevokeAgent,
  canSeeAllAgents,
  canSetTeamRole,
  canUpdateCompany,
} from "@clankerboard/shared";

/**
 * Whether the caller may see a Project, and so its Tickets and Activity. REST
 * reads and the live stream both ask this, so a narrower rule added here
 * applies to both. Every User in a Company sees all its Projects (Spec 03),
 * so for now it is the Company check the reads' queries already make.
 */
export function canSeeProject(ctx: CompanyContext, project: { companyId: string }) {
  return project.companyId === ctx.companyId;
}

/** Hard-deleting a Project or Ticket is for owner and admin Users only. */
export function assertMayHardDelete(ctx: CompanyContext) {
  assertMayDelete(ctx);
  if (!canHardDelete(ctx.role)) throw forbidden();
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
