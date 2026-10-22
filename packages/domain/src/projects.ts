import { randomUUID } from "node:crypto";
import { type Db, schema, type Tx } from "@agentkanban/db";
import type { CreateProjectInput, ProjectView, UpdateProjectInput } from "@agentkanban/shared";
import { and, asc, eq } from "drizzle-orm";
import { withActivity } from "./activity";
import { changedFields } from "./changes";
import type { CompanyContext, DomainDeps } from "./context";
import { conflict, isUniqueViolation, notFound } from "./errors";
import { assertMayHardDelete, canSeeProject } from "./permissions";
import { findTeam } from "./teams";

export type { ProjectView };

const { projects, teams } = schema;

function selectProjects(db: Db | Tx) {
  return db
    .select({
      id: projects.id,
      companyId: projects.companyId,
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

function view({ teamId, teamName, companyId: _companyId, ...row }: ProjectRow): ProjectView {
  return { ...row, team: teamId && teamName ? { id: teamId, name: teamName } : null };
}

export async function getProject({ db }: DomainDeps, ctx: CompanyContext, key: string) {
  return findProject(db, ctx, key);
}

/**
 * A Project the caller may see, by its Project Key. Anywhere else, it doesn't
 * exist.
 */
export async function findProject(db: Db | Tx, ctx: CompanyContext, key: string) {
  const [row] = await selectProjects(db).where(
    and(eq(projects.companyId, ctx.companyId), eq(projects.key, key)),
  );
  if (!row || !canSeeProject(ctx, row)) throw notFound();
  return view(row);
}

export async function createProject(
  deps: DomainDeps,
  ctx: CompanyContext,
  input: CreateProjectInput,
): Promise<ProjectView> {
  if (input.teamId) await findTeam(deps.db, ctx, input.teamId);
  const now = deps.clock.now();
  const teamId = input.teamId ?? null;
  try {
    return await withActivity(deps, ctx, async (tx, record) => {
      const id = randomUUID();
      await tx.insert(projects).values({
        id,
        companyId: ctx.companyId,
        teamId,
        name: input.name,
        key: input.key,
        createdAt: now,
        updatedAt: now,
      });
      await record({
        projectId: id,
        kind: "project.created",
        payload: { key: input.key, name: input.name, teamId },
      });
      return findProject(tx, ctx, input.key);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("That project key is taken.");
    throw error;
  }
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
  return rows.filter((row) => canSeeProject(ctx, row)).map(view);
}

export async function updateProject(
  deps: DomainDeps,
  ctx: CompanyContext,
  key: string,
  input: UpdateProjectInput,
): Promise<ProjectView> {
  return withActivity(deps, ctx, async (tx, record) => {
    const project = await findProject(tx, ctx, key);
    if (input.teamId) await findTeam(tx, ctx, input.teamId);
    const fields = { name: input.name, teamId: input.teamId };
    const changes = changedFields({ name: project.name, teamId: project.team?.id ?? null }, fields);
    if (Object.keys(changes).length === 0) return project;

    await tx
      .update(projects)
      .set({ ...fields, updatedAt: deps.clock.now() })
      .where(eq(projects.id, project.id));
    await record({ projectId: project.id, kind: "project.updated", payload: { changes } });
    return findProject(tx, ctx, key);
  });
}

/**
 * Hard-deletes a Project with every Ticket, Comment, and Activity in it. The
 * deletion is still published to the event bus, though its own Activity row
 * goes with the Project.
 */
export async function deleteProject(deps: DomainDeps, ctx: CompanyContext, key: string) {
  assertMayHardDelete(ctx);
  await withActivity(deps, ctx, async (tx, record) => {
    const project = await findProject(tx, ctx, key);
    await record({ projectId: project.id, kind: "project.deleted", payload: { key } });
    await tx.delete(projects).where(eq(projects.id, project.id));
  });
}
