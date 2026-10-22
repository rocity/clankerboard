import { z } from "zod";
import { ticketLinkViewKinds, ticketPriority, ticketStatus, ticketType } from "./tickets";

// Response shapes for the board. The domain's view types are derived from
// these, and Spec 04's MCP tools reuse them as output schemas. Timestamps are
// Dates in code and ISO strings on the wire (`z.toJSONSchema(…, { io: "input" })`).

export const timestamp = z.codec(z.iso.datetime(), z.date(), {
  decode: (value) => new Date(value),
  encode: (date) => date.toISOString(),
});

/** A User or an Agent. A revoked Agent keeps its name and is marked revoked. */
export const actorView = z.object({
  type: z.enum(["user", "agent"]),
  id: z.string(),
  name: z.string(),
  revoked: z.boolean(),
});
export type ActorView = z.output<typeof actorView>;

export const projectView = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  team: z.object({ id: z.string(), name: z.string() }).nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type ProjectView = z.output<typeof projectView>;

export const ticketView = z.object({
  id: z.string(),
  key: z.string(),
  projectKey: z.string(),
  number: z.number().int(),
  title: z.string(),
  description: z.string(),
  type: ticketType,
  status: ticketStatus,
  priority: ticketPriority,
  rank: z.string(),
  /** Points from 0 to 100, or null when blank. */
  estimate: z.number().int().nullable(),
  /** At least one Ticket blocking this one is neither Done nor archived. */
  blocked: z.boolean(),
  /** How many Tickets blocking this one are neither Done nor archived. */
  blockedByCount: z.number().int(),
  parent: z.object({ key: z.string(), title: z.string(), type: ticketType }).nullable(),
  assignee: actorView.nullable(),
  createdBy: actorView,
  archivedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type TicketView = z.output<typeof ticketView>;
/** A Ticket as it travels in JSON: timestamps are ISO strings. The web app's shape. */
export type TicketWire = z.input<typeof ticketView>;

/**
 * A Ticket Link as seen from one of its Tickets: the kind from that side, and
 * the other Ticket, which may be in another Project or archived.
 */
export const ticketLinkView = z.object({
  kind: z.enum(ticketLinkViewKinds),
  key: z.string(),
  projectKey: z.string(),
  title: z.string(),
  type: ticketType,
  status: ticketStatus,
  archived: z.boolean(),
  createdBy: actorView,
  createdAt: timestamp,
});
export type TicketLinkView = z.output<typeof ticketLinkView>;

export const ticketPage = z.object({
  tickets: z.array(ticketView),
  nextCursor: z.string().nullable(),
});
export type TicketPage = z.output<typeof ticketPage>;

export const commentView = z.object({
  id: z.string(),
  author: actorView,
  body: z.string(),
  createdAt: timestamp,
});
export type CommentView = z.output<typeof commentView>;

/** One entry of a Ticket's timeline: a Comment, or any other Activity. */
export const timelineItem = z.discriminatedUnion("type", [
  commentView.extend({ type: z.literal("comment"), activityId: z.number().int() }),
  z.object({
    type: z.literal("activity"),
    id: z.number().int(),
    kind: z.string(),
    actor: actorView,
    payload: z.record(z.string(), z.unknown()),
    createdAt: timestamp,
  }),
]);
export type TimelineItem = z.output<typeof timelineItem>;

/** One Activity on the board, as the live stream sends it. */
export const activityView = z.object({
  id: z.number().int(),
  kind: z.string(),
  projectId: z.string(),
  /** The Ticket's key, also for a Ticket that was hard-deleted. Null for Project Activity. */
  ticketKey: z.string().nullable(),
  actor: actorView,
  payload: z.record(z.string(), z.unknown()),
  createdAt: timestamp,
});
export type ActivityView = z.output<typeof activityView>;

/**
 * The data of one live stream event: the Activity, and the Ticket as it is
 * now. `ticket` is null for Project Activity and for a hard-deleted Ticket,
 * whose key is still in `activity.ticketKey`.
 */
export const streamedActivity = z.object({
  activity: activityView,
  ticket: ticketView.nullable(),
});
export type StreamedActivity = z.output<typeof streamedActivity>;
