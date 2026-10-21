import { z } from "zod";

export const agentName = z
  .string({ error: "Enter a name." })
  .trim()
  .min(1, { error: "Enter a name." })
  .max(64, { error: "Agent names can be up to 64 characters." });

export const createAgentInput = z.object({ name: agentName });
export const renameAgentInput = z.object({ name: agentName });

export const createApiKeyInput = z.object({
  label: z
    .string({ error: "Enter a label." })
    .trim()
    .min(1, { error: "Enter a label." })
    .max(64, { error: "Labels can be up to 64 characters." }),
});
