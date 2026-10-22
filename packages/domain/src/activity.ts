import { schema, type Tx } from "@clankerboard/db";
import { sql } from "drizzle-orm";
import { type ActorRef, actorColumns, refOf } from "./actors";
import type { Actor, CompanyContext, DomainDeps } from "./context";

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
 * An Actor lost access to a Company: a removed member (`user`), or a revoked
 * Agent or one of its keys (`agent`). Published after the change commits.
 */
export type Revocation = { companyId: string; actor: Actor };

export type RevocationListener = (revocation: Revocation) => void;

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
  publishRevocation(revocation: Revocation): void;
  /** Calls `listener` with every Revocation, in any Company, from now on. */
  subscribeRevocations(listener: RevocationListener): () => void;
};

export type RecordActivity = (input: {
  projectId: string;
  ticketId?: string | null;
  ticketKey?: string | null;
  kind: string;
  payload?: Record<string, unknown>;
}) => Promise<ActivityEvent>;

// Namespaces the per-Company advisory lock, so it can't collide with another use.
const activityLockSpace = 0x41435456; // "ACTV"

/**
 * Runs a change in one transaction with a recorder that writes Activity
 * credited to the acting Actor. The recorded Activity is published only after
 * the transaction commits, and never if it rolls back.
 *
 * Changes in one Company run one at a time, so Activity ids commit in id
 * order. Otherwise a slow change could commit id 40 after a client already
 * saw 41, and a reconnect from 41 would never send 40.
 */
export async function withActivity<T>(
  { db, clock, events }: DomainDeps,
  ctx: CompanyContext,
  change: (tx: Tx, record: RecordActivity) => Promise<T>,
): Promise<T> {
  const recorded: ActivityEvent[] = [];
  const actor = refOf(ctx.actor);
  const result = await db.transaction(async (tx) => {
    // Taken before the change locks any row, so it can't deadlock with one.
    await tx.execute(
      sql`select pg_advisory_xact_lock(${activityLockSpace}, hashtext(${ctx.companyId}))`,
    );
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
