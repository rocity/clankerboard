import { z } from "zod";

export const companyRoles = ["owner", "admin", "member"] as const;
export const companyRole = z.enum(companyRoles, { error: "Pick owner, admin, or member." });
export type CompanyRole = z.infer<typeof companyRole>;

export const teamRoles = ["lead", "member"] as const;
export const teamRole = z.enum(teamRoles, { error: "Pick lead or member." });
export type TeamRole = z.infer<typeof teamRole>;
