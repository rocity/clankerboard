import { randomUUID } from "node:crypto";
import { type Db, schema, type Tx } from "@clankerboard/db";
import type { TeamRole } from "@clankerboard/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import type { CompanyContext, DomainDeps } from "./context";
import { conflict, forbidden, notFound } from "./errors";
import { canManageTeamMembers, canManageTeams, canSetTeamRole } from "./permissions";

export type TeamView = {
  id: string;
  name: string;
  memberCount: number;
  /** The caller's own Role on this Team, or null when they aren't on it. */
  myRole: TeamRole | null;
  createdAt: Date;
};

export type TeamMemberView = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: TeamRole;
};

const { teams, teamMemberships, memberships, users } = schema;

const isUniqueViolation = (error: unknown) =>
  (error as { cause?: { code?: string } })?.cause?.code === "23505";

/** A Team in the caller's Company. Anywhere else, it doesn't exist. */
export async function findTeam(db: Db | Tx, ctx: CompanyContext, teamId: string) {
  const [team] = await db
    .select({ id: teams.id, name: teams.name, createdAt: teams.createdAt })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.companyId, ctx.companyId)));
  if (!team) throw notFound();
  return team;
}

export async function teamRoleOf(db: Db | Tx, teamId: string, userId: string) {
  const [row] = await db
    .select({ role: teamMemberships.role })
    .from(teamMemberships)
    .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId)));
  return row?.role ?? null;
}

function selectTeams(db: Db, ctx: CompanyContext, teamId?: string) {
  return db
    .select({
      id: teams.id,
      name: teams.name,
      createdAt: teams.createdAt,
      memberCount: sql<number>`count(${teamMemberships.id})::int`,
      myRole: sql<TeamRole | null>`max(case when ${teamMemberships.userId} = ${ctx.userId} then ${teamMemberships.role} end)`,
    })
    .from(teams)
    .leftJoin(teamMemberships, eq(teamMemberships.teamId, teams.id))
    .where(and(eq(teams.companyId, ctx.companyId), teamId ? eq(teams.id, teamId) : undefined))
    .groupBy(teams.id)
    .orderBy(asc(teams.name));
}

async function teamView(db: Db, ctx: CompanyContext, teamId: string): Promise<TeamView> {
  const [team] = await selectTeams(db, ctx, teamId);
  if (!team) throw notFound();
  return team;
}

function listTeamMembers(db: Db, teamId: string): Promise<TeamMemberView[]> {
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      role: teamMemberships.role,
    })
    .from(teamMemberships)
    .innerJoin(users, eq(users.id, teamMemberships.userId))
    .where(eq(teamMemberships.teamId, teamId))
    .orderBy(asc(teamMemberships.createdAt), asc(users.email));
}

async function memberView(db: Db, teamId: string, userId: string): Promise<TeamMemberView> {
  const member = (await listTeamMembers(db, teamId)).find((m) => m.userId === userId);
  if (!member) throw notFound();
  return member;
}

export function listTeams({ db }: DomainDeps, ctx: CompanyContext): Promise<TeamView[]> {
  return selectTeams(db, ctx);
}

export async function getTeam({ db }: DomainDeps, ctx: CompanyContext, teamId: string) {
  const team = await teamView(db, ctx, teamId);
  return { team, members: await listTeamMembers(db, teamId) };
}

const nameTaken = () => conflict("A team with that name already exists.");

export async function createTeam(
  { db }: DomainDeps,
  ctx: CompanyContext,
  input: { name: string },
): Promise<TeamView> {
  if (!canManageTeams(ctx.role)) throw forbidden();
  const id = randomUUID();
  try {
    await db.insert(teams).values({ id, companyId: ctx.companyId, name: input.name });
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
  return teamView(db, ctx, id);
}

export async function renameTeam(
  { db, clock }: DomainDeps,
  ctx: CompanyContext,
  teamId: string,
  input: { name: string },
): Promise<TeamView> {
  await findTeam(db, ctx, teamId);
  if (!canManageTeams(ctx.role)) throw forbidden();
  try {
    await db
      .update(teams)
      .set({ name: input.name, updatedAt: clock.now() })
      .where(eq(teams.id, teamId));
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
  return teamView(db, ctx, teamId);
}

export async function deleteTeam({ db }: DomainDeps, ctx: CompanyContext, teamId: string) {
  await findTeam(db, ctx, teamId);
  if (!canManageTeams(ctx.role)) throw forbidden();
  await db.delete(teams).where(eq(teams.id, teamId));
}

async function assertCanManageMembers(db: Db | Tx, ctx: CompanyContext, teamId: string) {
  await findTeam(db, ctx, teamId);
  const isLead = (await teamRoleOf(db, teamId, ctx.userId)) === "lead";
  if (!canManageTeamMembers(ctx.role, isLead)) throw forbidden();
}

/** Adds a Company member to a Team. Inside a transaction, pass it as `db`. */
export async function insertTeamMembership(
  db: Db | Tx,
  ctx: Pick<CompanyContext, "companyId">,
  teamId: string,
  userId: string,
) {
  const [member] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.companyId, ctx.companyId), eq(memberships.userId, userId)));
  if (!member) throw notFound();
  const inserted = await db
    .insert(teamMemberships)
    .values({ id: randomUUID(), teamId, userId, role: "member" })
    .onConflictDoNothing()
    .returning({ id: teamMemberships.id });
  return inserted.length > 0;
}

export async function addTeamMember(
  deps: DomainDeps,
  ctx: CompanyContext,
  teamId: string,
  userId: string,
): Promise<TeamMemberView> {
  await assertCanManageMembers(deps.db, ctx, teamId);
  if (!(await insertTeamMembership(deps.db, ctx, teamId, userId))) {
    throw conflict("Already on this team.");
  }
  return memberView(deps.db, teamId, userId);
}

export async function removeTeamMember(
  { db }: DomainDeps,
  ctx: CompanyContext,
  teamId: string,
  userId: string,
) {
  await assertCanManageMembers(db, ctx, teamId);
  const removed = await db
    .delete(teamMemberships)
    .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId)))
    .returning({ id: teamMemberships.id });
  if (removed.length === 0) throw notFound();
}

export async function setTeamMemberRole(
  { db }: DomainDeps,
  ctx: CompanyContext,
  teamId: string,
  userId: string,
  role: TeamRole,
): Promise<TeamMemberView> {
  await findTeam(db, ctx, teamId);
  if (!canSetTeamRole(ctx.role)) throw forbidden();
  const updated = await db
    .update(teamMemberships)
    .set({ role })
    .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId)))
    .returning({ id: teamMemberships.id });
  if (updated.length === 0) throw notFound();
  return memberView(db, teamId, userId);
}
