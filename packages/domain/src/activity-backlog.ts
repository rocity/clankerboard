import { schema } from "@clankerboard/db";
import { and, asc, eq, gt, max } from "drizzle-orm";
import type { ActivityEvent } from "./activity";
import { refFromColumns } from "./actors";
import type { CompanyContext, DomainDeps } from "./context";
import { ticketKeyOf } from "./ticket-store";

const { activities, tickets, projects } = schema;

/**
 * What a client that last saw `afterId` missed: the Activity itself, or, when
 * that can't be replayed, the latest Activity id to resume from once the
 * client has refetched.
 */
export type ActivityBacklog =
  | { kind: "replay"; events: ActivityEvent[] }
  | { kind: "refetch"; latestId: number };

/**
 * The Company's Activity with ids greater than `afterId`, oldest first, as the
 * event bus would have published it, up to `limit` of them. More than `limit`,
 * or an `afterId` of null (the client's position is unknown), means refetch.
 * Gaps in the ids are normal: hard deletes take their Ticket's or Project's
 * Activity with them.
 */
export async function activityBacklog(
  { db }: DomainDeps,
  ctx: CompanyContext,
  afterId: number | null,
  limit: number,
): Promise<ActivityBacklog> {
  const inCompany = eq(activities.companyId, ctx.companyId);
  const refetch = async (): Promise<ActivityBacklog> => {
    const [latest] = await db
      .select({ id: max(activities.id) })
      .from(activities)
      .where(inCompany);
    return { kind: "refetch", latestId: latest?.id ?? 0 };
  };
  if (afterId === null) return refetch();
  const rows = await db
    .select({ activity: activities, projectKey: projects.key, number: tickets.number })
    .from(activities)
    .leftJoin(tickets, eq(tickets.id, activities.ticketId))
    .leftJoin(projects, eq(projects.id, tickets.projectId))
    .where(and(inCompany, gt(activities.id, afterId)))
    .orderBy(asc(activities.id))
    .limit(limit + 1);
  if (rows.length > limit) return refetch();
  const events = rows.map(({ activity, projectKey, number }) => ({
    id: activity.id,
    companyId: activity.companyId,
    projectId: activity.projectId,
    ticketId: activity.ticketId,
    ticketKey: keyOf(activity.payload, projectKey, number),
    actor: refFromColumns(activity.actorUserId, activity.actorAgentId) ?? missingActor(activity.id),
    kind: activity.kind,
    payload: activity.payload,
    createdAt: activity.createdAt,
  }));
  return { kind: "replay", events };
}

/** The Ticket's key, or for a hard delete the key its payload kept. */
function keyOf(payload: Record<string, unknown>, projectKey: string | null, number: number | null) {
  if (projectKey !== null && number !== null) return ticketKeyOf({ projectKey, number });
  return typeof payload.ticketKey === "string" ? payload.ticketKey : null;
}

function missingActor(id: number): never {
  // The activities_one_actor check makes this unreachable.
  throw new Error(`activity ${id} has no actor`);
}
