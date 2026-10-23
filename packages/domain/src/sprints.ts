import { randomUUID } from "node:crypto";
import type { Db, Tx } from "@agentkanban/db";
import {
  type CreateSprintInput,
  defaultSprintEnd,
  type SprintView,
  type StartSprintInput,
  sprintName,
  type TicketType,
  type UpdateSprintInput,
  utcDate,
} from "@agentkanban/shared";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type RecordActivity, withActivity } from "./activity";
import { archiveRow } from "./archive";
import { changedFields } from "./changes";
import type { CompanyContext, DomainDeps } from "./context";
import { conflict, invalid, notFound } from "./errors";
import { assertMayDelete, assertMayManageSprints } from "./permissions";
import { findProject } from "./projects";
import {
  projects,
  selectTickets,
  sprints,
  type TicketRow,
  ticketActivity,
  ticketKeyOf,
  tickets,
} from "./ticket-store";

export type { SprintView };

type SprintRow = typeof sprints.$inferSelect;
type ProjectRef = { id: string; key: string };

/** A Sprint of the Project, by number. Anything else, including a malformed number, is not found. */
async function findSprint(db: Db | Tx, project: ProjectRef, number: number, lock = false) {
  if (!Number.isInteger(number) || number < 1) throw notFound();
  const query = db
    .select()
    .from(sprints)
    .where(and(eq(sprints.projectId, project.id), eq(sprints.number, number)));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw notFound();
  return row;
}

/** What each Sprint's live Tickets add up to, by Sprint id. */
async function sprintTotals(db: Db | Tx, sprintIds: string[]) {
  if (sprintIds.length === 0)
    return new Map<string, { tickets: number; done: number; points: number }>();
  const rows = await db
    .select({
      sprintId: tickets.sprintId,
      tickets: count(),
      done: sql<number>`count(*) filter (where ${tickets.status} = 'done')`.mapWith(Number),
      points: sql<number>`coalesce(sum(${tickets.estimate}), 0)`.mapWith(Number),
    })
    .from(tickets)
    .where(and(inArray(tickets.sprintId, sprintIds), isNull(tickets.archivedAt)))
    .groupBy(tickets.sprintId);
  return new Map(rows.map(({ sprintId, ...totals }) => [sprintId as string, totals]));
}

async function sprintViews(db: Db | Tx, rows: SprintRow[]): Promise<SprintView[]> {
  const totals = await sprintTotals(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => {
    const total = totals.get(row.id);
    return {
      id: row.id,
      number: row.number,
      goal: row.goal,
      state: row.state,
      startedAt: row.startedAt,
      endsOn: row.endsOn,
      finishedAt: row.finishedAt,
      ticketCount: total?.tickets ?? 0,
      doneCount: total?.done ?? 0,
      points: total?.points ?? 0,
      createdAt: row.createdAt,
    };
  });
}

async function sprintView(db: Db | Tx, row: SprintRow): Promise<SprintView> {
  const [view] = await sprintViews(db, [row]);
  if (!view) throw notFound();
  return view;
}

/** The Activity input for a change to a Sprint. Project Activity, carrying the Project Key and number. */
function sprintActivity(
  project: ProjectRef,
  kind: string,
  number: number,
  payload: Record<string, unknown> = {},
): Parameters<RecordActivity>[0] {
  return { projectId: project.id, kind, payload: { projectKey: project.key, number, ...payload } };
}

/** Adds a Planned Sprint numbered after the Project's last, recording `sprint.created`. */
async function insertSprint(
  tx: Tx,
  ctx: CompanyContext,
  project: ProjectRef,
  goal: string,
  now: Date,
  record: RecordActivity,
) {
  // Taking the number locks the Project row, as creating a Ticket does.
  const [counter] = await tx
    .update(projects)
    .set({ nextSprintNumber: sql`${projects.nextSprintNumber} + 1` })
    .where(eq(projects.id, project.id))
    .returning({ next: projects.nextSprintNumber });
  if (!counter) throw notFound();
  const [row] = await tx
    .insert(sprints)
    .values({
      id: randomUUID(),
      companyId: ctx.companyId,
      projectId: project.id,
      number: counter.next - 1,
      goal,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error("sprint insert returned nothing");
  await record(sprintActivity(project, "sprint.created", row.number, { goal }));
  return row;
}

/** Every Sprint of a Project, by number. */
export async function listSprints(
  { db }: DomainDeps,
  ctx: CompanyContext,
  projectKey: string,
): Promise<SprintView[]> {
  const project = await findProject(db, ctx, projectKey);
  const rows = await db
    .select()
    .from(sprints)
    .where(eq(sprints.projectId, project.id))
    .orderBy(asc(sprints.number));
  return sprintViews(db, rows);
}

export async function createSprint(
  deps: DomainDeps,
  ctx: CompanyContext,
  projectKey: string,
  input: CreateSprintInput,
): Promise<SprintView> {
  assertMayManageSprints(ctx);
  return withActivity(deps, ctx, async (tx, record) => {
    const project = await findProject(tx, ctx, projectKey);
    const row = await insertSprint(tx, ctx, project, input.goal, deps.clock.now(), record);
    return sprintView(tx, row);
  });
}

/** Changes a Sprint's goal, or the active Sprint's end date. A Finished Sprint stays as it was. */
export async function updateSprint(
  deps: DomainDeps,
  ctx: CompanyContext,
  projectKey: string,
  number: number,
  input: UpdateSprintInput,
): Promise<SprintView> {
  assertMayManageSprints(ctx);
  return withActivity(deps, ctx, async (tx, record) => {
    const project = await findProject(tx, ctx, projectKey);
    const row = await findSprint(tx, project, number, true);
    if (row.state === "finished") throw conflict(`${sprintName(row.number)} is finished.`);
    if (input.endsOn !== undefined) {
      if (row.state !== "active") throw invalid("Set the end date when you start the sprint.");
      assertEndsAfterStart(input.endsOn, row.startedAt);
    }
    const changes = changedFields({ goal: row.goal, endsOn: row.endsOn }, input);
    if (Object.keys(changes).length === 0) return sprintView(tx, row);

    const [updated] = await tx
      .update(sprints)
      .set({ ...input, updatedAt: deps.clock.now() })
      .where(eq(sprints.id, row.id))
      .returning();
    if (!updated) throw notFound();
    await record(sprintActivity(project, "sprint.updated", row.number, { changes }));
    return sprintView(tx, updated);
  });
}

function assertEndsAfterStart(endsOn: string, startedAt: Date | null) {
  // Compared as UTC calendar dates.
  if (startedAt && endsOn < utcDate(startedAt)) {
    throw invalid("The end date can't be before the start date.");
  }
}

/**
 * Starts a Planned Sprint. Without an end date, it runs as long as the
 * Project's last finished Sprint did, or two weeks.
 */
export async function startSprint(
  deps: DomainDeps,
  ctx: CompanyContext,
  projectKey: string,
  number: number,
  input: StartSprintInput,
): Promise<SprintView> {
  assertMayManageSprints(ctx);
  return withActivity(deps, ctx, async (tx, record) => {
    const project = await findProject(tx, ctx, projectKey);
    const row = await findSprint(tx, project, number, true);
    if (row.state !== "planned") throw conflict(`${sprintName(row.number)} isn't planned.`);
    const [active] = await tx
      .select({ number: sprints.number })
      .from(sprints)
      .where(and(eq(sprints.projectId, project.id), eq(sprints.state, "active")));
    if (active) throw conflict(`Finish ${sprintName(active.number)} before starting another.`);

    const now = deps.clock.now();
    const [last] = await tx
      .select({ startedAt: sprints.startedAt, endsOn: sprints.endsOn })
      .from(sprints)
      .where(and(eq(sprints.projectId, project.id), eq(sprints.state, "finished")))
      .orderBy(desc(sprints.finishedAt), desc(sprints.number))
      .limit(1);
    const endsOn =
      input.endsOn ??
      defaultSprintEnd(
        utcDate(now),
        last?.startedAt && last.endsOn
          ? { startedOn: utcDate(last.startedAt), endsOn: last.endsOn }
          : null,
      );
    assertEndsAfterStart(endsOn, now);

    const [started] = await tx
      .update(sprints)
      .set({
        state: "active",
        startedAt: now,
        endsOn,
        goal: input.goal ?? row.goal,
        updatedAt: now,
      })
      .where(eq(sprints.id, row.id))
      .returning();
    if (!started) throw notFound();
    await record(sprintActivity(project, "sprint.started", row.number, { endsOn }));
    return sprintView(tx, started);
  });
}

/**
 * Finishes the active Sprint: every live Ticket in it in Done is archived, the
 * way `archiveTicket` does it, and every other live Ticket moves to the next
 * Sprint, the Planned one with the lowest number or a new one. Statuses and
 * ranks stay. Archived Tickets in the Sprint stay with it. The next Sprint is
 * left Planned.
 */
export async function finishSprint(
  deps: DomainDeps,
  ctx: CompanyContext,
  projectKey: string,
  number: number,
): Promise<{ sprint: SprintView; next: SprintView }> {
  assertMayManageSprints(ctx);
  return withActivity(deps, ctx, async (tx, record) => {
    const project = await findProject(tx, ctx, projectKey);
    const row = await findSprint(tx, project, number, true);
    if (row.state !== "active") throw conflict("Only the active sprint can be finished.");
    const now = deps.clock.now();

    const [planned] = await tx
      .select()
      .from(sprints)
      .where(and(eq(sprints.projectId, project.id), eq(sprints.state, "planned")))
      .orderBy(asc(sprints.number))
      .limit(1)
      .for("update");
    const next = planned ?? (await insertSprint(tx, ctx, project, "", now, record));

    const members = await selectTickets(tx)
      .where(and(eq(tickets.sprintId, row.id), isNull(tickets.archivedAt)))
      .orderBy(asc(tickets.number))
      .for("update", { of: tickets });
    const done = members.filter((ticket) => ticket.status === "done");
    const rest = members.filter((ticket) => ticket.status !== "done");

    for (const ticket of done) {
      await archiveRow(tx, ticket, record, now, { sprint: row.number });
    }
    if (rest.length > 0) {
      await tx
        .update(tickets)
        .set({ sprintId: next.id, updatedAt: now })
        .where(
          inArray(
            tickets.id,
            rest.map((ticket) => ticket.id),
          ),
        );
    }
    for (const ticket of rest) {
      await record(sprintChange(ticket, row.number, next.number));
    }

    const [finished] = await tx
      .update(sprints)
      .set({ state: "finished", finishedAt: now, updatedAt: now })
      .where(eq(sprints.id, row.id))
      .returning();
    if (!finished) throw notFound();
    await record(
      sprintActivity(project, "sprint.finished", row.number, {
        next: next.number,
        archived: done.map(ticketKeyOf),
        moved: rest.map(ticketKeyOf),
      }),
    );
    const [sprint, nextView] = await sprintViews(tx, [finished, next]);
    if (!sprint || !nextView) throw notFound();
    return { sprint, next: nextView };
  });
}

/** The `ticket.updated` Activity for a Ticket leaving one Sprint for another, or for none. */
function sprintChange(ticket: TicketRow, from: number | null, to: number | null) {
  return ticketActivity(ticket, "ticket.updated", { changes: { sprint: { from, to } } });
}

/**
 * Deletes a Planned Sprint. Every Ticket in it, archived ones too, goes back to
 * no Sprint, each recording the change. Its number is never reused.
 */
export async function deleteSprint(
  deps: DomainDeps,
  ctx: CompanyContext,
  projectKey: string,
  number: number,
) {
  assertMayManageSprints(ctx);
  assertMayDelete(ctx);
  await withActivity(deps, ctx, async (tx, record) => {
    const project = await findProject(tx, ctx, projectKey);
    const row = await findSprint(tx, project, number, true);
    if (row.state !== "planned") throw conflict("You can delete only a planned sprint.");
    const members = await selectTickets(tx)
      .where(eq(tickets.sprintId, row.id))
      .orderBy(asc(tickets.number))
      .for("update", { of: tickets });
    if (members.length > 0) {
      await tx
        .update(tickets)
        .set({ sprintId: null, updatedAt: deps.clock.now() })
        .where(eq(tickets.sprintId, row.id));
    }
    for (const ticket of members) await record(sprintChange(ticket, row.number, null));
    await record(sprintActivity(project, "sprint.deleted", row.number));
    await tx.delete(sprints).where(eq(sprints.id, row.id));
  });
}

/**
 * The Sprint a Ticket of `type` is being put in, by number in its Project, or
 * null for no Sprint. Refuses an Epic, a number the Project doesn't have, and
 * a Finished Sprint.
 */
export async function resolveSprint(
  tx: Db | Tx,
  project: ProjectRef,
  number: number | null,
  type: TicketType,
): Promise<SprintRow | null> {
  if (number === null) return null;
  if (type === "epic") throw invalid("Epics can't be in a sprint.");
  const [row] = await tx
    .select()
    .from(sprints)
    .where(and(eq(sprints.projectId, project.id), eq(sprints.number, number)));
  if (!row) throw invalid(`${project.key} has no ${sprintName(number)}.`);
  if (row.state === "finished") throw invalid(`${sprintName(number)} is finished.`);
  return row;
}
