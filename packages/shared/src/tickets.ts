import { z } from "zod";
import { projectKey } from "./projects";

export const ticketTypes = ["epic", "story", "task", "bug"] as const;
export const ticketStatuses = ["backlog", "todo", "in_progress", "review", "done"] as const;
export const ticketPriorities = ["low", "medium", "high", "urgent"] as const;

export const ticketType = z.enum(ticketTypes, { error: "Pick epic, story, task, or bug." });
export const ticketStatus = z.enum(ticketStatuses, {
  error: "Pick backlog, todo, in_progress, review, or done.",
});
export const ticketPriority = z.enum(ticketPriorities, {
  error: "Pick low, medium, high, or urgent.",
});
export type TicketType = z.infer<typeof ticketType>;

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

const title = z
  .string({ error: "Enter a title." })
  .trim()
  .min(1, { error: "Enter a title." })
  .max(200, { error: "Titles can be up to 200 characters." });

const description = z
  .string({ error: "Descriptions are Markdown text." })
  .max(50_000, { error: "Descriptions can be up to 50,000 characters." });

export const createTicketInput = z.object({
  projectKey,
  title,
  description: description.default(""),
  type: ticketType,
  priority: ticketPriority.default("medium"),
  parentKey: ticketKey.nullish(),
});
export type CreateTicketInput = z.infer<typeof createTicketInput>;

export const updateTicketInput = z.object({
  title: title.optional(),
  description: description.optional(),
  type: ticketType.optional(),
  priority: ticketPriority.optional(),
  /** Null clears the Parent. */
  parentKey: ticketKey.nullable().optional(),
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
  position: z
    .number({ error: "Positions are whole numbers from 0." })
    .int({ error: "Positions are whole numbers from 0." })
    .min(0, { error: "Positions are whole numbers from 0." })
    .optional(),
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

/** Who a list is narrowed to: nobody, any Agent, any User, or one Actor. */
export const assigneeFilter = z.string().regex(/^(unassigned|agents|users|user:.+|agent:.+)$/, {
  error: "Filter assignees by unassigned, agents, users, user:<id>, or agent:<id>.",
});

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
  archived: z
    .enum(["exclude", "include", "only"], { error: "Use archived=include or archived=only." })
    .default("exclude"),
  limit: z.coerce
    .number({ error: "Limits are whole numbers from 1 to 200." })
    .int({ error: "Limits are whole numbers from 1 to 200." })
    .min(1, { error: "Limits are whole numbers from 1 to 200." })
    .max(200, { error: "Limits are whole numbers from 1 to 200." })
    .default(50),
  cursor: z.string().optional(),
});
export type ListTicketsQuery = z.infer<typeof listTicketsQuery>;
