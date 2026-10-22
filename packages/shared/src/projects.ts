import { z } from "zod";

export const projectKey = z
  .string({ error: "Project keys are 2 to 10 uppercase letters." })
  .regex(/^[A-Z]{2,10}$/, { error: "Project keys are 2 to 10 uppercase letters." });

const projectName = z
  .string({ error: "Enter a name." })
  .trim()
  .min(1, { error: "Enter a name." })
  .max(80, { error: "Names can be up to 80 characters." });

export const createProjectInput = z.object({
  name: projectName,
  key: projectKey,
  teamId: z.string().min(1).nullish(),
});
export type CreateProjectInput = z.infer<typeof createProjectInput>;

export const listProjectsQuery = z.object({ teamId: z.string().min(1).optional() });

export const updateProjectInput = z.object({
  name: projectName.optional(),
  /** Null clears the Team. */
  teamId: z.string().min(1).nullable().optional(),
  key: z.never({ error: "A project key can't be changed." }).optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectInput>;
