import { z } from "zod";
import { teamRole } from "./roles";

export const teamName = z
  .string({ error: "Enter a name." })
  .trim()
  .min(1, { error: "Enter a name." })
  .max(80, { error: "Names can be up to 80 characters." });

export const createTeamInput = z.object({ name: teamName });
export const renameTeamInput = z.object({ name: teamName });

export const addTeamMemberInput = z.object({
  userId: z.string({ error: "Pick a member." }).min(1, { error: "Pick a member." }),
});

export const setTeamRoleInput = z.object({ role: teamRole });
