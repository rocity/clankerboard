import { z } from "zod";
import { companyRole } from "./roles";

export const createInviteInput = z.object({
  email: z
    .string({ error: "Enter a valid email address." })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: "Enter a valid email address." })),
  role: companyRole.default("member"),
});
export type CreateInviteInput = z.infer<typeof createInviteInput>;

export const inviteTokenInput = z.object({
  token: z.string({ error: "This invite link is not valid." }).min(1, {
    error: "This invite link is not valid.",
  }),
});

export const inviteStatuses = ["pending", "accepted", "revoked", "expired"] as const;
export type InviteStatus = (typeof inviteStatuses)[number];
