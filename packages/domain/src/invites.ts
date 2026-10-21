import { createHash, randomBytes, randomUUID } from "node:crypto";
import { type Db, schema, type Tx } from "@clankerboard/db";
import type { CompanyRole, CreateInviteInput, InviteStatus } from "@clankerboard/shared";
import { and, asc, eq, getTableColumns, inArray, isNull } from "drizzle-orm";
import type { CompanyView } from "./companies";
import type { CompanyContext, DomainDeps, UserContext } from "./context";
import { conflict, DomainError, forbidden, gone, notFound } from "./errors";
import { canInviteToTeam, canListInvites } from "./permissions";
import { findTeam, insertTeamMembership, teamRoleOf } from "./teams";

export type InviteView = {
  id: string;
  email: string;
  role: CompanyRole;
  /** Set for a Team Invite. */
  teamId: string | null;
  teamName: string | null;
  status: InviteStatus;
  expiresAt: Date;
  createdAt: Date;
};

/** What the inviter gets back: the only time the link is ever shown. */
export type IssuedInvite = {
  invite: InviteView;
  link: string;
  emailed: boolean;
};

export type InvitePreview = {
  companyName: string;
  teamName: string | null;
  email: string;
  role: CompanyRole;
  inviterName: string;
  expiresAt: Date;
};

const { invites, companies, memberships, users, sessions, teams, teamMemberships } = schema;

/** An Invite row joined with its Team's name. */
type InviteRow = typeof invites.$inferSelect & { teamName: string | null };

function selectInvites(db: Db | Tx) {
  return db
    .select({ ...getTableColumns(invites), teamName: teams.name })
    .from(invites)
    .leftJoin(teams, eq(teams.id, invites.teamId));
}

const linkNotFound = () => new DomainError("not_found", "This invite link is not valid.");

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

function statusOf(row: Pick<InviteRow, "status" | "expiresAt">, now: Date): InviteStatus {
  if (row.status === "pending" && row.expiresAt <= now) return "expired";
  return row.status;
}

function view(row: InviteRow, now: Date): InviteView {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    teamId: row.teamId,
    teamName: row.teamName,
    status: statusOf(row, now),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/** Throws the plain reason a link can't be used, if it can't. */
function assertUsable(row: InviteRow, now: Date) {
  const status = statusOf(row, now);
  if (status === "accepted") throw gone("This invite was already used.");
  if (status === "revoked") throw gone("This invite was revoked.");
  if (status === "expired") throw gone("This invite has expired.");
}

async function findByToken(db: Db, token: string) {
  const [row] = await selectInvites(db).where(eq(invites.tokenHash, hashInviteToken(token)));
  if (!row) throw linkNotFound();
  return row;
}

async function findInCompany(db: Db, ctx: CompanyContext, inviteId: string) {
  const [row] = await selectInvites(db).where(
    and(eq(invites.id, inviteId), eq(invites.companyId, ctx.companyId)),
  );
  if (!row) throw notFound();
  return row;
}

/** Owners and admins manage any Invite they could create; leads manage their Team's. */
async function assertMayManage(
  db: Db,
  ctx: CompanyContext,
  role: CompanyRole,
  teamId: string | null,
) {
  const isLead = teamId !== null && (await teamRoleOf(db, teamId, ctx.userId)) === "lead";
  if (!canInviteToTeam(ctx.role, role, isLead)) throw forbidden();
}

async function sendInviteEmail(
  { db, mailer }: DomainDeps,
  ctx: CompanyContext,
  row: InviteRow,
  link: string,
) {
  const [company] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, ctx.companyId));
  const [inviter] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, ctx.userId));
  const roleName =
    row.role === "admin" ? "an admin" : row.role === "owner" ? "an owner" : "a member";
  const offer = row.teamName
    ? `join the ${row.teamName} team at ${company?.name}`
    : `join ${company?.name} as ${roleName}`;
  return mailer.send({
    to: row.email,
    subject: `Join ${company?.name} on Clankerboard`,
    text: [
      `${inviter?.name} invited you to ${offer}.`,
      "",
      `Accept the invite: ${link}`,
      "",
      `This link expires on ${row.expiresAt.toUTCString()}.`,
    ].join("\n"),
  });
}

async function issue(deps: DomainDeps, ctx: CompanyContext, row: InviteRow, token: string) {
  const link = `${deps.config.baseUrl}/invite#${token}`;
  const emailed = await sendInviteEmail(deps, ctx, row, link);
  return { invite: view(row, deps.clock.now()), link, emailed };
}

/** Invites someone to the Company, or to one of its Teams when `teamId` is set. */
export async function createInvite(
  deps: DomainDeps,
  ctx: CompanyContext,
  input: CreateInviteInput,
): Promise<IssuedInvite> {
  const { db, clock, config } = deps;
  const teamId = input.teamId ?? null;
  const team = teamId ? await findTeam(db, ctx, teamId) : null;
  await assertMayManage(db, ctx, input.role, teamId);
  const now = clock.now();

  const [member] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.companyId, ctx.companyId), eq(users.email, input.email)));
  if (member && !teamId) throw conflict("That person is already a member.");
  if (member && teamId && (await teamRoleOf(db, teamId, member.userId))) {
    throw conflict("Already on this team.");
  }

  const pending = await db
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.companyId, ctx.companyId),
        eq(invites.email, input.email),
        eq(invites.status, "pending"),
        teamId ? eq(invites.teamId, teamId) : isNull(invites.teamId),
      ),
    );
  if (pending.some((row) => statusOf(row, now) === "pending")) {
    throw conflict("That email already has a pending invite.");
  }

  const { token, tokenHash } = newToken();
  const [row] = await db
    .insert(invites)
    .values({
      id: randomUUID(),
      companyId: ctx.companyId,
      teamId,
      email: input.email,
      role: input.role,
      status: "pending",
      tokenHash,
      expiresAt: new Date(now.getTime() + config.inviteTtlMs),
      inviterId: ctx.userId,
      createdAt: now,
    })
    .returning();
  if (!row) throw new Error("invite insert returned nothing");
  return issue(deps, ctx, { ...row, teamName: team?.name ?? null }, token);
}

/**
 * Invites nobody has acted on yet, including expired ones that can be resent.
 * Owners and admins see all of them; a lead sees their own Teams' Invites.
 */
export async function listInvites(deps: DomainDeps, ctx: CompanyContext): Promise<InviteView[]> {
  const { db } = deps;
  let teamFilter: ReturnType<typeof inArray> | undefined;
  if (!canListInvites(ctx.role)) {
    const led = await db
      .select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .where(
        and(
          eq(teams.companyId, ctx.companyId),
          eq(teamMemberships.userId, ctx.userId),
          eq(teamMemberships.role, "lead"),
        ),
      );
    if (led.length === 0) throw forbidden();
    teamFilter = inArray(
      invites.teamId,
      led.map((row) => row.teamId),
    );
  }
  const rows = await selectInvites(db)
    .where(and(eq(invites.companyId, ctx.companyId), eq(invites.status, "pending"), teamFilter))
    .orderBy(asc(invites.createdAt));
  const now = deps.clock.now();
  return rows.map((row) => view(row, now));
}

/** Issues a fresh link and expiry. The previous link stops working. */
export async function resendInvite(
  deps: DomainDeps,
  ctx: CompanyContext,
  inviteId: string,
): Promise<IssuedInvite> {
  const row = await findInCompany(deps.db, ctx, inviteId);
  await assertMayManage(deps.db, ctx, row.role, row.teamId);
  if (row.status !== "pending") assertUsable(row, deps.clock.now());

  const { token, tokenHash } = newToken();
  const expiresAt = new Date(deps.clock.now().getTime() + deps.config.inviteTtlMs);
  const [updated] = await deps.db
    .update(invites)
    .set({ tokenHash, expiresAt })
    .where(and(eq(invites.id, row.id), eq(invites.status, "pending")))
    .returning();
  if (!updated) throw conflict("This invite changed. Refresh and try again.");
  return issue(deps, ctx, { ...updated, teamName: row.teamName }, token);
}

export async function revokeInvite(
  deps: DomainDeps,
  ctx: CompanyContext,
  inviteId: string,
): Promise<InviteView> {
  const row = await findInCompany(deps.db, ctx, inviteId);
  await assertMayManage(deps.db, ctx, row.role, row.teamId);
  if (row.status !== "pending") assertUsable(row, deps.clock.now());

  const [updated] = await deps.db
    .update(invites)
    .set({ status: "revoked" })
    .where(and(eq(invites.id, row.id), eq(invites.status, "pending")))
    .returning();
  if (!updated) throw conflict("This invite changed. Refresh and try again.");
  return view({ ...updated, teamName: row.teamName }, deps.clock.now());
}

/** Public: what a link offers, or the plain reason it can't be used. */
export async function previewInvite(deps: DomainDeps, token: string): Promise<InvitePreview> {
  const row = await findByToken(deps.db, token);
  assertUsable(row, deps.clock.now());
  const [details] = await deps.db
    .select({ companyName: companies.name, inviterName: users.name })
    .from(companies)
    .innerJoin(users, eq(users.id, row.inviterId))
    .where(eq(companies.id, row.companyId));
  if (!details) throw linkNotFound();
  return {
    ...details,
    teamName: row.teamName,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt,
  };
}

/** Whether a sign-up for `email` carries a live Invite for that same email. */
export async function hasUsableInvite(
  deps: Pick<DomainDeps, "db" | "clock">,
  token: string,
  email: string,
) {
  const [row] = await deps.db
    .select()
    .from(invites)
    .where(eq(invites.tokenHash, hashInviteToken(token)));
  return Boolean(
    row && statusOf(row, deps.clock.now()) === "pending" && row.email === email.toLowerCase(),
  );
}

/**
 * Accepts an Invite for the signed-in User: creates the Company Membership if
 * they don't have one (an existing member keeps their Role), joins the Team for
 * a Team Invite, and makes the Company their active one. All in one transaction.
 */
export async function acceptInvite(
  deps: DomainDeps,
  user: UserContext,
  token: string,
): Promise<CompanyView> {
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, hashInviteToken(token)))
      .for("update");
    if (!row) throw linkNotFound();
    assertUsable({ ...row, teamName: null }, deps.clock.now());
    if (row.email !== user.email.toLowerCase()) {
      throw forbidden("This invite is for a different email address.");
    }

    await tx
      .insert(memberships)
      .values({ id: randomUUID(), companyId: row.companyId, userId: user.userId, role: row.role })
      .onConflictDoNothing();
    if (row.teamId) {
      await insertTeamMembership(tx, { companyId: row.companyId }, row.teamId, user.userId);
    }
    await tx
      .update(invites)
      .set({ status: "accepted", acceptedAt: deps.clock.now() })
      .where(eq(invites.id, row.id));
    await tx
      .update(sessions)
      .set({ activeCompanyId: row.companyId })
      .where(eq(sessions.id, user.sessionId));

    const [company] = await tx
      .select({
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        role: memberships.role,
      })
      .from(companies)
      .innerJoin(
        memberships,
        and(eq(memberships.companyId, companies.id), eq(memberships.userId, user.userId)),
      )
      .where(eq(companies.id, row.companyId));
    if (!company) throw notFound();
    return company;
  });
}
