import { schema, type Tx } from "@clankerboard/db";
import type { CompanyRole } from "@clankerboard/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { CompanyContext, DomainDeps } from "./context";
import { conflict, forbidden, notFound } from "./errors";
import { canChangeRole, canListMembers, canRemoveMember } from "./permissions";

export type MemberView = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: CompanyRole;
  joinedAt: Date;
};

const { memberships, users, sessions, teams, teamMemberships } = schema;

const memberColumns = {
  userId: users.id,
  name: users.name,
  email: users.email,
  image: users.image,
  role: memberships.role,
  joinedAt: memberships.createdAt,
};

const lastOwner = () => conflict("A company needs at least one owner.");

export async function listMembers({ db }: DomainDeps, ctx: CompanyContext): Promise<MemberView[]> {
  if (!canListMembers(ctx.role)) throw forbidden();
  return db
    .select(memberColumns)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.companyId, ctx.companyId))
    .orderBy(asc(memberships.createdAt), asc(users.email));
}

/** Locks the Company's owner rows so concurrent changes can't remove the last owner. */
async function ownerCount(tx: Tx, companyId: string) {
  const owners = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.companyId, companyId), eq(memberships.role, "owner")))
    .for("update");
  return owners.length;
}

async function findMember(tx: Tx, companyId: string, userId: string) {
  const [member] = await tx
    .select(memberColumns)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.companyId, companyId), eq(memberships.userId, userId)));
  return member;
}

export async function changeMemberRole(
  { db }: DomainDeps,
  ctx: CompanyContext,
  userId: string,
  role: CompanyRole,
): Promise<MemberView> {
  return db.transaction(async (tx) => {
    const owners = await ownerCount(tx, ctx.companyId);
    const member = await findMember(tx, ctx.companyId, userId);
    if (!member) throw notFound();
    if (member.role === role) return member;
    if (!canChangeRole(ctx.role, member.role, role)) {
      throw forbidden(
        member.role === "owner" || role === "owner"
          ? "Only an owner can change an owner's role."
          : undefined,
      );
    }
    if (member.role === "owner" && owners === 1) throw lastOwner();
    await tx
      .update(memberships)
      .set({ role })
      .where(and(eq(memberships.companyId, ctx.companyId), eq(memberships.userId, userId)));
    return { ...member, role };
  });
}

/** Removes a member, or lets the caller leave when `userId` is their own. */
export async function removeMember(
  { db, hooks }: DomainDeps,
  ctx: CompanyContext,
  userId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const owners = await ownerCount(tx, ctx.companyId);
    const member = await findMember(tx, ctx.companyId, userId);
    if (!member) throw notFound();
    const leaving = userId === ctx.userId;
    if (!leaving && !canRemoveMember(ctx.role, member.role)) {
      throw forbidden(member.role === "owner" ? "Only an owner can remove an owner." : undefined);
    }
    if (member.role === "owner" && owners === 1) throw lastOwner();

    await tx
      .delete(memberships)
      .where(and(eq(memberships.companyId, ctx.companyId), eq(memberships.userId, userId)));
    await tx
      .delete(teamMemberships)
      .where(
        and(
          eq(teamMemberships.userId, userId),
          inArray(
            teamMemberships.teamId,
            tx.select({ id: teams.id }).from(teams).where(eq(teams.companyId, ctx.companyId)),
          ),
        ),
      );
    await tx
      .update(sessions)
      .set({ activeCompanyId: null })
      .where(and(eq(sessions.userId, userId), eq(sessions.activeCompanyId, ctx.companyId)));
    for (const hook of hooks.memberRemoved) {
      await hook(tx, { companyId: ctx.companyId, userId });
    }
  });
}
