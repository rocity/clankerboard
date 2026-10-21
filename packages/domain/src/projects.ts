import { randomUUID } from "node:crypto";
import { type Db, schema, type Tx } from "@clankerboard/db";
import type { CreateProjectInput, UpdateProjectInput } from "@clankerboard/shared";
import { and, asc, eq } from "drizzle-orm";
import type { CompanyContext, DomainDeps } from "./context";
import { conflict, forbidden, isUniqueViolation, notFound } from "./errors";
import { assertMayDelete, canDeleteBoardContent } from "./permissions";
import { findTeam } from "./teams";

export type ProjectView = {
  id: string;
  key: string;
  name: string;
  team: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
};

const { projects, teams } = schema;

function selectProjects(db: Db | Tx) {
  return db
    .select({
      id: projects.id,
      key: projects.key,
      name: projects.name,
      teamId: teams.id,
      teamName: teams.name,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .leftJoin(teams, eq(teams.id, projects.teamId));
}

type ProjectRow = Awaited<ReturnType<ReturnType<typeof selectProjects>["execute"]>>[number];

function view({ teamId, teamName, ...row }: ProjectRow): ProjectView {
  return { ...row, team: teamId && teamName ? { id: teamId, name: teamName } : null };
}

/** A Project in the caller's Company, by its Project Key. Anywhere else, it doesn't exist. */
export async function findProject(db: Db | Tx, ctx: CompanyContext, key: string) {
  const [row] = await selectProjects(db).where(
    and(eq(projects.companyId, ctx.companyId), eq(projects.key, key)),
  );
  if (!row) throw notFound();
  return view(row);
}

export async function createProject(
  { db, clock }: DomainDeps,
  ctx: CompanyContext,
  input: CreateProjectInput,
): Promise<ProjectView> {
  if (input.teamId) await findTeam(db, ctx, input.teamId);
  const now = clock.now();
  try {
    await db.insert(projects).values({
      id: randomUUID(),
      companyId: ctx.companyId,
      teamId: input.teamId ?? null,
      name: input.name,
      key: input.key,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("That project key is taken.");
    throw error;
  }
  return findProject(db, ctx, input.key);
}

export async function listProjects(
  { db }: DomainDeps,
  ctx: CompanyContext,
  filter: { teamId?: string },
): Promise<ProjectView[]> {
  const rows = await selectProjects(db)
    .where(
      and(
        eq(projects.companyId, ctx.companyId),
        filter.teamId ? eq(projects.teamId, filter.teamId) : undefined,
      ),
    )
    .orderBy(asc(projects.key));
  return rows.map(view);
}

export async function updateProject(
  { db, clock }: DomainDeps,
  ctx: CompanyContext,
  key: string,
  input: UpdateProjectInput,
): Promise<ProjectView> {
  const project = await findProject(db, ctx, key);
  if (input.teamId) await findTeam(db, ctx, input.teamId);
  const changes: Partial<typeof projects.$inferInsert> = { updatedAt: clock.now() };
  if (input.name !== undefined) changes.name = input.name;
  if (input.teamId !== undefined) changes.teamId = input.teamId;
  await db.update(projects).set(changes).where(eq(projects.id, project.id));
  return findProject(db, ctx, key);
}

/** Hard-deletes a Project with every Ticket, Comment, and Activity in it. */
export async function deleteProject({ db }: DomainDeps, ctx: CompanyContext, key: string) {
  assertMayDelete(ctx);
  const project = await findProject(db, ctx, key);
  if (!canDeleteBoardContent(ctx.role)) throw forbidden();
  await db.delete(projects).where(eq(projects.id, project.id));
}
