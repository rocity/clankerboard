import type { Actor, CompanyContext } from "./context";

/**
 * A change that ends open live streams, published after it commits.
 * - `access-lost`: an Actor lost access to a Company. A removed User
 *   (`user`), or a revoked Agent or one of its keys (`agent`).
 * - `company-switched`: a session made `companyId` its active Company, so its
 *   streams of any other Company show the wrong board.
 */
export type Revocation =
  | { kind: "access-lost"; companyId: string; actor: Actor }
  | { kind: "company-switched"; sessionId: string; companyId: string };

/** An open live stream: whose access it streams with, and the session it was opened with, if any. */
export type StreamSubscriber = { ctx: CompanyContext; sessionId?: string };

/**
 * Whether `revocation` ends `stream`. A removed User's streams end along with
 * those of their Agents, which act with the User's permissions. A revoked key
 * ends its Agent's streams on every key. A Company switch ends the session's
 * streams of every other Company.
 */
export function revokes(revocation: Revocation, { ctx, sessionId }: StreamSubscriber) {
  if (revocation.kind === "company-switched") {
    return sessionId === revocation.sessionId && ctx.companyId !== revocation.companyId;
  }
  if (ctx.companyId !== revocation.companyId) return false;
  const { actor } = revocation;
  return actor.type === "user"
    ? ctx.userId === actor.userId
    : ctx.actor.type === "agent" && ctx.actor.agentId === actor.agentId;
}
