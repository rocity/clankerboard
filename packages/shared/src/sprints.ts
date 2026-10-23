import { z } from "zod";

/** A Sprint's states, in the order it goes through them. A Project has at most one active Sprint. */
export const sprintStates = ["planned", "active", "finished"] as const;
export type SprintState = (typeof sprintStates)[number];

/** How a Sprint reads in copy: "Sprint 4". */
export const sprintName = (number: number) => `Sprint ${number}`;

const numberError = { error: "Sprints are numbered from 1." };

/** A Sprint's number within its Project. */
export const sprintNumber = z.number(numberError).int(numberError).min(1, numberError);

export const sprintGoal = z
  .string({ error: "Sprint goals are text." })
  .trim()
  .max(500, { error: "Sprint goals can be up to 500 characters." });

/** A calendar date. Sprints end on a day, not at a time. */
export const sprintEndsOn = z.iso.date({ error: "Give the end date as YYYY-MM-DD." });

export const createSprintInput = z.object({ goal: sprintGoal.default("") });
export type CreateSprintInput = z.infer<typeof createSprintInput>;

/** Only the active Sprint has an end date to change. */
export const updateSprintInput = z.object({
  goal: sprintGoal.optional(),
  endsOn: sprintEndsOn.optional(),
});
export type UpdateSprintInput = z.infer<typeof updateSprintInput>;

/** Without `endsOn`, the Sprint is as long as the Project's last finished one, or two weeks. */
export const startSprintInput = z.object({
  goal: sprintGoal.optional(),
  endsOn: sprintEndsOn.optional(),
});
export type StartSprintInput = z.infer<typeof startSprintInput>;

export type SprintFilter = { kind: "active" | "none" } | { kind: "number"; number: number };

/** Tickets in the active Sprint of their Project, in no Sprint, or in the Sprint of that number. */
export const sprintFilter = z
  .string({ error: "Filter sprints by active, none, or a sprint number." })
  .regex(/^(active|none|[1-9]\d{0,8})$/, {
    error: "Filter sprints by active, none, or a sprint number.",
  })
  .transform((value): SprintFilter => {
    if (value === "active" || value === "none") return { kind: value };
    return { kind: "number", number: Number(value) };
  });

export const defaultSprintDays = 14;

const day = 24 * 60 * 60 * 1000;
const dayOf = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** The UTC calendar date of a moment, as `YYYY-MM-DD`. */
export const utcDate = (moment: Date) => moment.toISOString().slice(0, 10);

/**
 * When a Sprint starting on `startsOn` ends by default: as many days later as
 * the last finished Sprint ran (from its start date to its end date), or two
 * weeks when there is none. Dates are `YYYY-MM-DD`.
 */
export function defaultSprintEnd(
  startsOn: string,
  lastFinished?: { startedOn: string; endsOn: string } | null,
) {
  const days = lastFinished
    ? Math.max(1, Math.round((dayOf(lastFinished.endsOn) - dayOf(lastFinished.startedOn)) / day))
    : defaultSprintDays;
  return utcDate(new Date(dayOf(startsOn) + days * day));
}
