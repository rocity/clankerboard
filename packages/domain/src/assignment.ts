import { type Db, schema, type Tx } from "@clankerboard/db";
import type { AssignTicketInput } from "@clankerboard/shared";
import { and, eq, isNull, ne } from "drizzle-orm";
import { withActivity } from "./activity";
import { type ActorRef, actorColumns, refFromColumns, refOf, sameActor } from "./actors";
import type { CompanyContext, DomainDeps } from "./context";
import { conflict, invalid, notFound } from "./errors";
import {
  bottomRank,
  findTicket,
  findTicketById,
  saveTicket,
  type TicketView,
  ticketActivity,
  ticketColumns,
  tickets,
  ticketView,
} from "./ticket-store";

const { memberships, agents } = schema;

/** Throws unless `ref` is an Actor who can hold work in this Company right now. */
async function assertAssignable(tx: Db | Tx, ctx: CompanyContext, ref: ActorRef) {
  if (ref.type === "user") {
    const [member] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.companyId, ctx.companyId), eq(memberships.userId, ref.id)));
    if (!member) throw notFound();
    return;
  }
  const [agent] = await tx
    .select({ revokedAt: agents.revokedAt, ownerRole: memberships.role })
    .from(agents)
    .leftJoin(
      memberships,
      and(eq(memberships.companyId, agents.companyId), eq(memberships.userId, agents.ownerUserId)),
    )
    .where(and(eq(agents.id, ref.id), eq(agents.companyId, ctx.companyId)));
  if (!agent) throw notFound();
  if (agent.revokedAt || !agent.ownerRole) throw invalid("That agent was revoked.");
}

export async function assignTicket(
  deps: DomainDeps,
  ctx: CompanyContext,
  key: string,
  input: AssignTicketInput,
): Promise<TicketView> {
  return withActivity(deps, ctx, async (tx, record) => {
    const row = await findTicket(tx, ctx, key, true);
    if (row.archivedAt) throw conflict("Archived tickets can't be assigned.");
    const to = input.assignee;
    if (to) await assertAssignable(tx, ctx, to);
    const from = refFromColumns(row.assigneeUserId, row.assigneeAgentId);
    if (sameActor(from, to)) return ticketView(tx, row);

    const columns = actorColumns(to);
    const view = await saveTicket(tx, row, {
      assigneeUserId: columns.userId,
      assigneeAgentId: columns.agentId,
      updatedAt: deps.clock.now(),
    });
    await record(ticketActivity(row, "ticket.assigned", { from, to }));
    return view;
  });
}

/**
 * Makes the caller the Assignee and moves the Ticket to the bottom of In
 * Progress, in one conditional update that only succeeds while nobody holds
 * it. Of two concurrent Claims, exactly one wins.
 */
export async function claimTicket(
  deps: DomainDeps,
  ctx: CompanyContext,
  key: string,
): Promise<TicketView> {
  return withActivity(deps, ctx, async (tx, record) => {
    const row = await findTicket(tx, ctx, key);
    const rank = await bottomRank(tx, row.projectId, "in_progress");
    const claimant = actorColumns(refOf(ctx.actor));

    const [claimed] = await tx
      .update(tickets)
      .set({
        assigneeUserId: claimant.userId,
        assigneeAgentId: claimant.agentId,
        status: "in_progress",
        rank,
        updatedAt: deps.clock.now(),
      })
      .where(
        and(
          eq(tickets.id, row.id),
          isNull(tickets.assigneeUserId),
          isNull(tickets.assigneeAgentId),
          isNull(tickets.archivedAt),
          ne(tickets.status, "done"),
        ),
      )
      .returning(ticketColumns);

    if (!claimed) {
      const current = await findTicketById(tx, ctx, row.id);
      if (current.archivedAt) throw conflict("Archived tickets can't be claimed.");
      const holder = await ticketView(tx, current);
      if (holder.assignee) {
        throw conflict(`${holder.key} is already held by ${holder.assignee.name}.`, {
          assignee: holder.assignee,
        });
      }
      throw conflict("Done tickets can't be claimed.");
    }

    await record(
      ticketActivity(row, "ticket.claimed", {
        from: { status: row.status, rank: row.rank },
        to: { status: "in_progress", rank },
      }),
    );
    return ticketView(tx, { ...claimed, projectKey: row.projectKey });
  });
}
