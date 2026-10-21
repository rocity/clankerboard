import { type Db, schema, type Tx } from "@clankerboard/db";
import type { CompanyRole } from "@clankerboard/shared";
import { and, eq } from "drizzle-orm";
import type { Clock } from "./clock";
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

export type DomainDeps = {
  db: Db;
  clock: Clock;
  mailer: Mailer;
  hooks: DomainHooks;
};

/** A signed-in User, before any Company is chosen. */
export type UserContext = {
  userId: string;
  email: string;
  sessionId: string;
};

/** The acting User inside their active Company. Every Company-scoped service takes one. */
export type CompanyContext = UserContext & {
  companyId: string;
  role: CompanyRole;
};

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
  return { ...user, companyId: activeCompanyId, role: membership.role };
}
