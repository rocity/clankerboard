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

export type ActivityListener = (event: ActivityEvent) => void;

/**
 * Where Activity goes after its transaction commits, and where the live stream
 * reads it from. The in-process bus is the v1 implementation; one backed by
 * Postgres LISTEN/NOTIFY can replace it without changing either side.
 */
export type EventBus = {
  publish(event: ActivityEvent): void;
  /**
   * Calls `listener` with each Activity of the Company published from now on,
   * in publish order. Returns the function that unsubscribes it.
   */
  subscribe(companyId: string, listener: ActivityListener): () => void;
};

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
