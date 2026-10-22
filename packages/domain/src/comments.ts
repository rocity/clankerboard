import { randomUUID } from "node:crypto";
import { schema } from "@agentkanban/db";
import type { CommentView, TimelineItem } from "@agentkanban/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { withActivity } from "./activity";
import { type ActorView, actorColumns, refFromColumns, refOf, resolveActors } from "./actors";
import type { CompanyContext, DomainDeps } from "./context";
import { findTicket, ticketActivity } from "./ticket-store";

export type { CommentView, TimelineItem };

const { comments, activities } = schema;

/** Joins a Comment to the comment.added Activity that recorded it. */
const recordedBy = and(
  eq(activities.kind, "comment.added"),
  eq(comments.id, sql`${activities.payload}->>'commentId'`),
);

export async function addComment(
  deps: DomainDeps,
  ctx: CompanyContext,
  key: string,
  input: { body: string },
): Promise<CommentView> {
  return withActivity(deps, ctx, async (tx, record) => {
    const ticket = await findTicket(tx, ctx, key);
    const author = refOf(ctx.actor);
    const { userId, agentId } = actorColumns(author);
    const [row] = await tx
      .insert(comments)
      .values({
        id: randomUUID(),
        companyId: ctx.companyId,
        ticketId: ticket.id,
        authorUserId: userId,
        authorAgentId: agentId,
        body: input.body,
        createdAt: deps.clock.now(),
      })
      .returning();
    if (!row) throw new Error("comment insert returned nothing");
    await record(ticketActivity(ticket, "comment.added", { commentId: row.id }));
    const actor = await resolveActors(tx, [author]);
    return {
      id: row.id,
      author: actor(author) as ActorView,
      body: row.body,
      createdAt: row.createdAt,
    };
  });
}

/**
 * A Ticket's timeline in one query: its Activity in id order, with each
 * Comment standing in for the Activity that recorded it.
 */
export async function getTimeline(
  { db }: DomainDeps,
  ctx: CompanyContext,
  key: string,
): Promise<TimelineItem[]> {
  const ticket = await findTicket(db, ctx, key);
  const rows = await db
    .select({
      activity: activities,
      comment: comments,
    })
    .from(activities)
    .leftJoin(comments, recordedBy)
    .where(eq(activities.ticketId, ticket.id))
    .orderBy(asc(activities.id));

  const refs = rows.map(({ activity, comment }) =>
    comment
      ? refFromColumns(comment.authorUserId, comment.authorAgentId)
      : refFromColumns(activity.actorUserId, activity.actorAgentId),
  );
  const actor = await resolveActors(db, refs);
  return rows.map(({ activity, comment }, i): TimelineItem => {
    const who = actor(refs[i] ?? null) as ActorView;
    if (comment) {
      return {
        type: "comment",
        id: comment.id,
        activityId: activity.id,
        author: who,
        body: comment.body,
        createdAt: comment.createdAt,
      };
    }
    return {
      type: "activity",
      id: activity.id,
      kind: activity.kind,
      actor: who,
      payload: activity.payload,
      createdAt: activity.createdAt,
    };
  });
}

/** A Ticket's Comments, oldest first. */
export async function listComments(
  { db }: DomainDeps,
  ctx: CompanyContext,
  key: string,
): Promise<CommentView[]> {
  const ticket = await findTicket(db, ctx, key);
  // Ordered by the Activity that recorded each Comment, so equal timestamps
  // still come back in the order they were written.
  const rows = await db
    .select({ comment: comments })
    .from(comments)
    .innerJoin(activities, recordedBy)
    .where(eq(comments.ticketId, ticket.id))
    .orderBy(asc(activities.id));
  const refs = rows.map(({ comment }) =>
    refFromColumns(comment.authorUserId, comment.authorAgentId),
  );
  const actor = await resolveActors(db, refs);
  return rows.map(({ comment }, i) => ({
    id: comment.id,
    author: actor(refs[i] ?? null) as ActorView,
    body: comment.body,
    createdAt: comment.createdAt,
  }));
}
