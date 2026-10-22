import { z } from "zod";
import { projectKey } from "./projects";

export const ticketTypes = ["epic", "story", "task", "bug"] as const;
export const ticketStatuses = ["backlog", "todo", "in_progress", "review", "done"] as const;
export const ticketPriorities = ["low", "medium", "high", "urgent"] as const;
/** How a Ticket Link is stored. `blocked_by` is only an input: it is stored as the reverse Blocks row. */
export const ticketLinkKinds = ["blocks", "relates_to"] as const;

export const ticketType = z.enum(ticketTypes, { error: "Pick epic, story, task, or bug." });
export const ticketStatus = z.enum(ticketStatuses, {
  error: "Pick backlog, todo, in_progress, review, or done.",
});
export const ticketPriority = z.enum(ticketPriorities, {
  error: "Pick low, medium, high, or urgent.",
});
export type TicketType = z.infer<typeof ticketType>;

/**
 * The hierarchy rules, in one place for REST, MCP, and the UI's Parent picker.
 * Epic sits on top, a Story or Bug may sit under an Epic, and a Task under an
 * Epic or a Story, so the deepest chain is Epic, Story, Task.
 */
export const parentTypesAllowed: Record<TicketType, readonly TicketType[]> = {
  epic: [],
  story: ["epic"],
  bug: ["epic"],
  task: ["epic", "story"],
};

/** How each Status reads in copy, matching GLOSSARY.md. */
export const statusLabels = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
} as const satisfies Record<(typeof ticketStatuses)[number], string>;
export type TicketStatus = z.infer<typeof ticketStatus>;
export type TicketPriority = z.infer<typeof ticketPriority>;

export const ticketKey = z
  .string({ error: "Use a ticket key like CB-42." })
  .regex(/^[A-Za-z]{2,10}-[1-9]\d{0,9}$/, { error: "Use a ticket key like CB-42." });

const positionError = { error: "Positions are whole numbers from 0." };
const limitError = { error: "Limits are whole numbers from 1 to 200." };

const title = z
  .string({ error: "Enter a title." })
  .trim()
  .min(1, { error: "Enter a title." })
  .max(200, { error: "Titles can be up to 200 characters." });

const description = z
  .string({ error: "Descriptions are Markdown text." })
  .max(50_000, { error: "Descriptions can be up to 50,000 characters." });

const estimateError = { error: "Estimates are whole numbers from 0 to 100." };

/** Points from 0 to 100. Null is blank, which is not the same as 0. */
export const ticketEstimate = z
  .number(estimateError)
  .int(estimateError)
  .min(0, estimateError)
  .max(100, estimateError);

export const createTicketInput = z.object({
  projectKey,
  title,
  description: description.default(""),
  type: ticketType,
  priority: ticketPriority.default("medium"),
  parentKey: ticketKey.nullish(),
  estimate: ticketEstimate.nullable().default(null),
});
export type CreateTicketInput = z.infer<typeof createTicketInput>;

export const updateTicketInput = z.object({
  title: title.optional(),
  description: description.optional(),
  type: ticketType.optional(),
  priority: ticketPriority.optional(),
  /** Null clears the Parent. */
  parentKey: ticketKey.nullable().optional(),
  /** Null clears the Estimate. */
  estimate: ticketEstimate.nullable().optional(),
});
export type UpdateTicketInput = z.infer<typeof updateTicketInput>;

/**
 * Moves a Ticket to a Status (its current one if omitted) and a place among
 * that Status's Tickets: right after `after`, right before `before`, between both, or at a
 * zero-based `position`. With no place given, it goes to the bottom.
 */
export const moveTicketInput = z.object({
  status: ticketStatus.optional(),
  after: ticketKey.optional(),
  before: ticketKey.optional(),
  position: z.number(positionError).int(positionError).min(0, positionError).optional(),
});
export type MoveTicketInput = z.infer<typeof moveTicketInput>;

export const actorRefInput = z.object(
  {
    type: z.enum(["user", "agent"], { error: "Assignees are a user or an agent." }),
    id: z.string().min(1),
  },
  { error: "Assignees are a user or an agent." },
);

/** Null clears the Assignee. */
export const assignTicketInput = z.object({ assignee: actorRefInput.nullable() });
export type AssignTicketInput = z.infer<typeof assignTicketInput>;

export const addCommentInput = z.object({
  body: z
    .string({ error: "Write a comment." })
    .trim()
    .min(1, { error: "Write a comment." })
    .max(20_000, { error: "Comments can be up to 20,000 characters." }),
});

export type AssigneeFilter =
  | { kind: "unassigned" | "agents" | "users" }
  | { kind: "actor"; actor: { type: "user" | "agent"; id: string } };

/** Who a list is narrowed to: nobody, any Agent, any User, or one Actor, as `user:<id>`. */
export const assigneeFilter = z
  .string()
  .regex(/^(unassigned|agents|users|user:.+|agent:.+)$/, {
    error: "Filter assignees by unassigned, agents, users, user:<id>, or agent:<id>.",
  })
  .transform((value): AssigneeFilter => {
    if (value === "unassigned" || value === "agents" || value === "users") return { kind: value };
    const [type, ...id] = value.split(":");
    return { kind: "actor", actor: { type: type as "user" | "agent", id: id.join(":") } };
  });

/** Archived Tickets are left out unless asked for. */
export const archivedFilter = z
  .enum(["exclude", "include"], { error: "Use archived=include." })
  .default("exclude");

export const listChildrenQuery = z.object({ archived: archivedFilter });

export const listTicketsQuery = z.object({
  projectKey: projectKey.optional(),
  status: ticketStatus.optional(),
  type: ticketType.optional(),
  priority: ticketPriority.optional(),
  assignee: assigneeFilter.optional(),
  parentKey: ticketKey.optional(),
  teamId: z.string().min(1).optional(),
  /** Free text over title and description. */
  q: z.string().trim().max(200).optional(),
  archived: archivedFilter,
  limit: z.coerce
    .number(limitError)
    .int(limitError)
    .min(1, limitError)
    .max(200, limitError)
    .default(50),
  cursor: z.string().optional(),
});
export type ListTicketsQuery = z.infer<typeof listTicketsQuery>;
