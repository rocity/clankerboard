import { z } from "zod";

export const companyName = z
  .string({ error: "Enter a name." })
  .trim()
  .min(1, { error: "Enter a name." })
  .max(80, { error: "Names can be up to 80 characters." });

/** Top-level web routes and server paths. A Company at /<slug> must not shadow them. */
export const reservedCompanySlugs = [
  "api",
  "invite",
  "sign-in",
  "sign-up",
  "mcp",
  "healthz",
] as const;

export const isReservedCompanySlug = (slug: string) =>
  (reservedCompanySlugs as readonly string[]).includes(slug);

export const companySlug = z
  .string({ error: "Enter a slug." })
  .max(48, { error: "Slugs can be up to 48 characters." })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error: "Slugs use lowercase letters, numbers, and single dashes.",
  })
  .refine((slug) => !isReservedCompanySlug(slug), { error: "That slug is reserved." });

export const createCompanyInput = z.object({
  name: companyName,
  slug: companySlug.optional(),
});
export type CreateCompanyInput = z.infer<typeof createCompanyInput>;

export const updateCompanyInput = z.object({
  name: companyName.optional(),
  slug: companySlug.optional(),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanyInput>;

export const switchCompanyInput = z.object({
  companyId: z.string({ error: "Pick a company." }).min(1, { error: "Pick a company." }),
});
