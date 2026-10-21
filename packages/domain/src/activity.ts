import { schema, type Tx } from "@clankerboard/db";
import { type ActorRef, actorColumns, refOf } from "./actors";
import type { CompanyContext, DomainDeps } from "./context";

/** One Activity, as stored and as published to the event bus. */
export type ActivityEvent = {
  id: number;
  companyId: string;
  projectId: string;
  ticketId: string | null;
  ticketKey: string | null;
  actor: ActorRef;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};

/** Where Activity goes after its transaction commits. Spec 05 streams it to browsers. */
export type EventBus = {
  publish(event: ActivityEvent): void;
};

export const noopEventBus: EventBus = { publish: () => {} };

export type RecordActivity = (input: {
  projectId: string;
  ticketId?: string | null;
  ticketKey?: string | null;
  kind: string;
  payload?: Record<string, unknown>;
}) => Promise<ActivityEvent>;

/**
 * Runs a change in one transaction with a recorder that writes Activity
 * credited to the acting Actor. The recorded Activity is published only after
 * the transaction commits, and never if it rolls back.
 */
export async function withActivity<T>(
  { db, clock, events }: DomainDeps,
  ctx: CompanyContext,
  change: (tx: Tx, record: RecordActivity) => Promise<T>,
): Promise<T> {
  const recorded: ActivityEvent[] = [];
  const actor = refOf(ctx.actor);
  const result = await db.transaction(async (tx) => {
    const record: RecordActivity = async (input) => {
      const { userId, agentId } = actorColumns(actor);
      const [row] = await tx
        .insert(schema.activities)
        .values({
          companyId: ctx.companyId,
          projectId: input.projectId,
          ticketId: input.ticketId ?? null,
          actorUserId: userId,
          actorAgentId: agentId,
          kind: input.kind,
          payload: input.payload ?? {},
          createdAt: clock.now(),
        })
        .returning();
      if (!row) throw new Error("activity insert returned nothing");
      const event: ActivityEvent = {
        id: row.id,
        companyId: row.companyId,
        projectId: row.projectId,
        ticketId: row.ticketId,
        ticketKey: input.ticketKey ?? null,
        actor,
        kind: row.kind,
        payload: row.payload,
        createdAt: row.createdAt,
      };
      recorded.push(event);
      return event;
    };
    return change(tx, record);
  });
  for (const event of recorded) events.publish(event);
  return result;
}
