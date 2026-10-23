import { randomUUID } from "node:crypto";
import { type CreateTicketInput, sprintName, type UpdateTicketInput } from "@agentkanban/shared";
import { eq, sql } from "drizzle-orm";
import { withActivity } from "./activity";
import { actorColumns, refOf } from "./actors";
import { changedFields } from "./changes";
import type { CompanyContext, DomainDeps } from "./context";
import { conflict, invalid, notFound } from "./errors";
import { assertChildrenAccept, assertPlacement } from "./hierarchy";
import { labelChanges, resolveLabels, setTicketLabels } from "./labels";
import { findProject } from "./projects";
import { resolveSprint } from "./sprints";
import {
  bottomRank,
  childrenOf,
  findParent,
  findTicket,
  findTicketById,
  labelsOf,
  projects,
  saveTicket,
  sprintsOf,
  type TicketView,
  ticketActivity,
  ticketColumns,
  ticketKeyOf,
  tickets,
  ticketView,
  ticketViews,
} from "./ticket-store";

export type { TicketView };

export async function createTicket(
  deps: DomainDeps,
  ctx: CompanyContext,
  input: CreateTicketInput,
): Promise<TicketView> {
  const now = deps.clock.now();
  return withActivity(deps, ctx, async (tx, record) => {
    const project = await findProject(tx, ctx, input.projectKey);
    const parent = input.parentKey ? await findParent(tx, ctx, input.parentKey) : null;
    assertPlacement({ type: input.type, projectId: project.id }, parent);
    const sprint = await resolveSprint(tx, project, input.sprint, input.type);
    // Taking the number locks the Project row, so concurrent creates queue
    // here and each sees the previous one's rank.
    const [counter] = await tx
      .update(projects)
      .set({ nextTicketNumber: sql`${projects.nextTicketNumber} + 1` })
      .where(eq(projects.id, project.id))
      .returning({ next: projects.nextTicketNumber });
    if (!counter) throw notFound();
    const creator = actorColumns(refOf(ctx.actor));

    const [inserted] = await tx
      .insert(tickets)
      .values({
        id: randomUUID(),
        companyId: ctx.companyId,
        projectId: project.id,
        number: counter.next - 1,
        parentId: parent?.id ?? null,
        title: input.title,
        description: input.description,
        type: input.type,
        priority: input.priority,
        estimate: input.estimate,
        progress: input.progress,
        sprintId: sprint?.id ?? null,
        status: "backlog",
        rank: await bottomRank(tx, project.id, "backlog"),
        createdByUserId: creator.userId,
        createdByAgentId: creator.agentId,
        createdAt: now,
        updatedAt: now,
      })
      .returning(ticketColumns);
    if (!inserted) throw new Error("ticket insert returned nothing");
    const row = { ...inserted, projectKey: project.key };
    const labels = await resolveLabels(tx, ctx, input.labels, now);
    await setTicketLabels(
      tx,
      row.id,
      labels.map((l) => l.id),
      now,
    );
    await record(
      ticketActivity(row, "ticket.created", {
        title: row.title,
        type: row.type,
        status: row.status,
        priority: row.priority,
        parent: parent ? ticketKeyOf(parent) : null,
      }),
    );
    return ticketView(tx, row);
  });
}

export async function getTicket({ db }: DomainDeps, ctx: CompanyContext, key: string) {
  return ticketView(db, await findTicket(db, ctx, key));
}

export async function updateTicket(
  deps: DomainDeps,
  ctx: CompanyContext,
  key: string,
  input: UpdateTicketInput,
): Promise<TicketView> {
  return withActivity(deps, ctx, async (tx, record) => {
    const now = deps.clock.now();
    const row = await findTicket(tx, ctx, key, true);
    const { parentKey, labels: labelNames, sprint: sprintNumber, ...fields } = input;
    const changes = changedFields(row, fields);
    const type = fields.type ?? row.type;

    const labels = labelNames && (await resolveLabels(tx, ctx, labelNames, now));
    if (labels) {
      const current = (await labelsOf(tx, [row.id])).get(row.id) ?? [];
      Object.assign(changes, labelChanges(current, labels));
    }

    const currentParent = row.parentId ? await findTicketById(tx, ctx, row.parentId) : null;
    const parent =
      parentKey === undefined
        ? currentParent
        : parentKey === null
          ? null
          : await findParent(tx, ctx, parentKey);
    if ((parent?.id ?? null) !== row.parentId) {
      changes.parent = {
        from: currentParent ? ticketKeyOf(currentParent) : null,
        to: parent ? ticketKeyOf(parent) : null,
      };
    }

    const currentSprint = row.sprintId
      ? (await sprintsOf(tx, [row.sprintId])).get(row.sprintId)
      : null;
    let sprintId = row.sprintId;
    if (sprintNumber !== undefined && sprintNumber !== (currentSprint?.number ?? null)) {
      if (row.archivedAt) throw conflict(`Restore ${ticketKeyOf(row)} before changing its sprint.`);
      const sprint = await resolveSprint(
        tx,
        { id: row.projectId, key: row.projectKey },
        sprintNumber,
        type,
      );
      sprintId = sprint?.id ?? null;
      changes.sprint = { from: currentSprint?.number ?? null, to: sprintNumber };
    } else if (type === "epic" && currentSprint) {
      throw invalid(
        `Remove ${ticketKeyOf(row)} from ${sprintName(currentSprint.number)} before making it an epic.`,
      );
    }
    if (Object.keys(changes).length === 0) return ticketView(tx, row);

    assertPlacement({ type, projectId: row.projectId }, parent);
    if (type !== row.type) assertChildrenAccept(type, await childrenOf(tx, row.id));

    if (changes.labels && labels) {
      await setTicketLabels(
        tx,
        row.id,
        labels.map((l) => l.id),
        now,
      );
    }
    const view = await saveTicket(tx, row, {
      ...fields,
      parentId: parent?.id ?? null,
      sprintId,
      updatedAt: now,
    });
    await record(ticketActivity(row, "ticket.updated", { changes }));
    return view;
  });
}

/** A Ticket's children. Archived ones are left out unless asked for. */
export async function listChildren(
  { db }: DomainDeps,
  ctx: CompanyContext,
  key: string,
  { includeArchived = false } = {},
): Promise<TicketView[]> {
  const ticket = await findTicket(db, ctx, key);
  return ticketViews(db, await childrenOf(db, ticket.id, { includeArchived }));
}
