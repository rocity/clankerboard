import { randomBytes, randomUUID } from "node:crypto";
import { type Db, schema } from "@agentkanban/db";
import {
  type CompanyRole,
  type CreateCompanyInput,
  isReservedCompanySlug,
  type UpdateCompanyInput,
} from "@agentkanban/shared";
import { and, asc, eq } from "drizzle-orm";
import type { CompanyContext, DomainDeps, UserContext } from "./context";
import { conflict, forbidden, isUniqueViolation, notFound } from "./errors";
import { canUpdateCompany } from "./permissions";

export type CompanyView = {
  id: string;
  name: string;
  slug: string;
  role: CompanyRole;
};

const { companies, memberships, sessions } = schema;

const companyColumns = {
  id: companies.id,
  name: companies.name,
  slug: companies.slug,
  role: memberships.role,
};

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "company"
  );
}

async function slugTaken(db: Db, slug: string) {
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.slug, slug));
  return Boolean(row);
}

async function freeSlug(db: Db, name: string) {
  const base = slugify(name);
  if (!isReservedCompanySlug(base) && !(await slugTaken(db, base))) return base;
  for (;;) {
    const candidate = `${base}-${randomBytes(3).toString("hex")}`;
    if (!(await slugTaken(db, candidate))) return candidate;
  }
}

/**
 * Creates a Company with the caller as its owner and makes it their active
 * Company, ending the session's live streams of other Companies.
 */
export async function createCompany(
  { db, events }: DomainDeps,
  user: UserContext,
  input: CreateCompanyInput,
): Promise<CompanyView> {
  const slug = input.slug ?? (await freeSlug(db, input.name));
  if (input.slug && (await slugTaken(db, input.slug))) throw conflict("That slug is taken.");

  const id = randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(companies).values({ id, name: input.name, slug });
      await tx
        .insert(memberships)
        .values({ id: randomUUID(), companyId: id, userId: user.userId, role: "owner" });
      await tx.update(sessions).set({ activeCompanyId: id }).where(eq(sessions.id, user.sessionId));
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("That slug is taken.");
    throw error;
  }
  events.publishRevocation({ kind: "company-switched", sessionId: user.sessionId, companyId: id });
  return { id, name: input.name, slug, role: "owner" };
}

/** The User's Companies, and which of them is active (null if none or a stale one). */
export async function listCompanies(
  { db }: DomainDeps,
  user: UserContext,
  activeCompanyId: string | null,
): Promise<{ companies: CompanyView[]; activeCompanyId: string | null }> {
  const list = await db
    .select(companyColumns)
    .from(memberships)
    .innerJoin(companies, eq(companies.id, memberships.companyId))
    .where(eq(memberships.userId, user.userId))
    .orderBy(asc(companies.createdAt), asc(companies.name));
  const active = list.find((company) => company.id === activeCompanyId);
  return { companies: list, activeCompanyId: active?.id ?? null };
}

/**
 * Makes a Company the session's active one, ending the session's live streams
 * of other Companies so they reconnect onto it. A Company the User isn't in
 * is not found.
 */
export async function switchCompany(
  { db, events }: DomainDeps,
  user: UserContext,
  companyId: string,
): Promise<CompanyView> {
  const [company] = await db
    .select(companyColumns)
    .from(memberships)
    .innerJoin(companies, eq(companies.id, memberships.companyId))
    .where(and(eq(memberships.userId, user.userId), eq(memberships.companyId, companyId)));
  if (!company) throw notFound();
  await db
    .update(sessions)
    .set({ activeCompanyId: companyId })
    .where(eq(sessions.id, user.sessionId));
  events.publishRevocation({ kind: "company-switched", sessionId: user.sessionId, companyId });
  return company;
}

export async function getCompany({ db }: DomainDeps, ctx: CompanyContext): Promise<CompanyView> {
  const [company] = await db
    .select({ id: companies.id, name: companies.name, slug: companies.slug })
    .from(companies)
    .where(eq(companies.id, ctx.companyId));
  if (!company) throw notFound();
  return { ...company, role: ctx.role };
}

export async function updateCompany(
  deps: DomainDeps,
  ctx: CompanyContext,
  input: UpdateCompanyInput,
): Promise<CompanyView> {
  if (!canUpdateCompany(ctx.role)) throw forbidden();
  const changes: Partial<typeof companies.$inferInsert> = {};
  if (input.name !== undefined) changes.name = input.name;
  if (input.slug !== undefined) changes.slug = input.slug;
  if (Object.keys(changes).length > 0) {
    try {
      await deps.db.update(companies).set(changes).where(eq(companies.id, ctx.companyId));
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("That slug is taken.");
      throw error;
    }
  }
  return getCompany(deps, ctx);
}
