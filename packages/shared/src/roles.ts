import { z } from "zod";

export const companyRoles = ["owner", "admin", "member"] as const;
export const companyRole = z.enum(companyRoles, { error: "Pick owner, admin, or member." });
export type CompanyRole = z.infer<typeof companyRole>;
