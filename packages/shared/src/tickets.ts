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
export type TicketStatus = z.infer<typeof ticketStatus>;
export type TicketPriority = z.infer<typeof ticketPriority>;

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
});
export type CreateTicketInput = z.infer<typeof createTicketInput>;

export const updateTicketInput = z.object({
  title: title.optional(),
  description: description.optional(),
  type: ticketType.optional(),
  priority: ticketPriority.optional(),
});
export type UpdateTicketInput = z.infer<typeof updateTicketInput>;
