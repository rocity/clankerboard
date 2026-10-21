import { randomUUID } from "node:crypto";
import { schema } from "@clankerboard/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { withActivity } from "./activity";
import { type ActorView, actorColumns, refFromColumns, refOf, resolveActors } from "./actors";
import type { CompanyContext, DomainDeps } from "./context";
import { findTicket, ticketKeyOf } from "./tickets";

export type CommentView = {
  id: string;
  author: ActorView;
  body: string;
  createdAt: Date;
};

export type TimelineItem =
  | ({ type: "comment"; activityId: number } & CommentView)
  | {
      type: "activity";
      id: number;
      kind: string;
      actor: ActorView;
      payload: Record<string, unknown>;
      createdAt: Date;
    };

const { comments, activities } = schema;

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
    await record({
      projectId: ticket.projectId,
      ticketId: ticket.id,
      ticketKey: ticketKeyOf(ticket),
      kind: "comment.added",
      payload: { commentId: row.id },
    });
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
    .leftJoin(
      comments,
      and(
        eq(activities.kind, "comment.added"),
        eq(comments.id, sql`${activities.payload}->>'commentId'`),
      ),
    )
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
  deps: DomainDeps,
  ctx: CompanyContext,
  key: string,
): Promise<CommentView[]> {
  const timeline = await getTimeline(deps, ctx, key);
  return timeline.flatMap((item) =>
    item.type === "comment"
      ? [{ id: item.id, author: item.author, body: item.body, createdAt: item.createdAt }]
      : [],
  );
}
