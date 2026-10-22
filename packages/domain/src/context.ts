import { type Db, schema, type Tx } from "@clankerboard/db";
import type { CompanyRole } from "@clankerboard/shared";
import { and, eq } from "drizzle-orm";
import type { Clock } from "./clock";
import type { EventBus } from "./event-bus";
import type { Mailer } from "./mailer";

export type MemberRemovedEvent = { companyId: string; userId: string };

/**
 * Extension points that run inside a domain transaction. A hook that throws
 * rolls the whole change back.
 */
export type DomainHooks = {
  /** A User lost their Membership, by removal or by leaving. */
  memberRemoved: ((tx: Tx, event: MemberRemovedEvent) => Promise<void>)[];
};

export type DomainConfig = {
  /** Public URL of the instance, for links in Invites. */
  baseUrl: string;
  /** How long an Invite link stays valid. */
  inviteTtlMs: number;
  /** When true, anyone who can reach the instance may sign up. */
  openSignup: boolean;
};

export type DomainDeps = {
  db: Db;
  clock: Clock;
  /** Sends nothing unless the operator configured email. */
  mailer: Mailer;
  config: DomainConfig;
  hooks: DomainHooks;
  /** Receives every Activity after its transaction commits. */
  events: EventBus;
};

/** A signed-in User, before any Company is chosen. */
export type UserContext = {
  userId: string;
  email: string;
  sessionId: string;
};

/** Anything that can act on the board: a User, or an Agent acting under its own name. */
export type Actor = { type: "user"; userId: string } | { type: "agent"; agentId: string };

/**
 * Who is acting, in which Company, with which effective Role. Every
 * Company-scoped service takes one. For an Agent, `userId` and `role` are its
 * owner's, resolved fresh on every request.
 */
export type CompanyContext = {
  actor: Actor;
  /** The User whose permissions apply: the acting User, or the Agent's owner. */
  userId: string;
  companyId: string;
  role: CompanyRole;
};

/**
 * Whether the session still exists and has not expired by `clock`. Read fresh
 * each time, since Better Auth extends a session's expiry as it is used.
 */
export async function isSessionLive(
  { db, clock }: Pick<DomainDeps, "db" | "clock">,
  sessionId: string,
): Promise<boolean> {
  const [session] = await db
    .select({ expiresAt: schema.sessions.expiresAt })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId));
  return session !== undefined && session.expiresAt > clock.now();
}

/**
 * Resolves the User's active Company, checking they still belong to it. A
 * stale or foreign Company id resolves to null.
 */
export async function resolveCompanyContext(
  db: Db,
  user: UserContext,
  activeCompanyId: string | null | undefined,
): Promise<CompanyContext | null> {
  if (!activeCompanyId) return null;
  const [membership] = await db
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.companyId, activeCompanyId),
        eq(schema.memberships.userId, user.userId),
      ),
    );
  if (!membership) return null;
  return {
    actor: { type: "user", userId: user.userId },
    userId: user.userId,
    companyId: activeCompanyId,
    role: membership.role,
  };
}
