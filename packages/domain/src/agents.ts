import { createHash, randomBytes, randomUUID } from "node:crypto";
import { type Db, schema } from "@clankerboard/db";
import { and, asc, eq, inArray, isNull, lte, max, or, sql } from "drizzle-orm";
import type { Clock } from "./clock";
import type { CompanyContext, DomainDeps, DomainHooks } from "./context";
import { conflict, forbidden, isUniqueViolation, notFound, unauthorized } from "./errors";
import { canRevokeAgent, canSeeAllAgents } from "./permissions";

export type AgentView = {
  id: string;
  name: string;
  owner: { userId: string; name: string; email: string };
  createdAt: Date;
  revokedAt: Date | null;
  /** When any of its keys was last used. */
  lastActiveAt: Date | null;
};

export type ApiKeyView = {
  id: string;
  label: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

const { agents, apiKeys, users, memberships } = schema;

export const apiKeyPrefix = "cb_";
const visiblePrefixLength = apiKeyPrefix.length + 8;
const apiKeyPattern = /^cb_[A-Za-z0-9_-]{32,}$/;

export function hashApiKey(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

const nameTaken = () => conflict("An agent with that name already exists.");

/** Agents and keys are managed by Users only, never by another Agent. */
function assertUser(ctx: CompanyContext) {
  if (ctx.actor.type !== "user") throw forbidden("Agents can't manage agents or API keys.");
}

function selectAgents(db: Db) {
  return db
    .select({
      id: agents.id,
      name: agents.name,
      owner: { userId: users.id, name: users.name, email: users.email },
      createdAt: agents.createdAt,
      revokedAt: agents.revokedAt,
      lastActiveAt: max(apiKeys.lastUsedAt),
    })
    .from(agents)
    .innerJoin(users, eq(users.id, agents.ownerUserId))
    .leftJoin(apiKeys, eq(apiKeys.agentId, agents.id))
    .groupBy(agents.id, users.id)
    .orderBy(asc(agents.name));
}

/** An Agent the caller may see: their own, or any in the Company for owners and admins. */
async function findVisibleAgent(db: Db, ctx: CompanyContext, agentId: string) {
  const [agent] = await selectAgents(db).where(
    and(
      eq(agents.id, agentId),
      eq(agents.companyId, ctx.companyId),
      canSeeAllAgents(ctx.role) ? undefined : eq(agents.ownerUserId, ctx.userId),
    ),
  );
  if (!agent) throw notFound();
  return agent;
}

export async function createAgent(
  { db, clock }: DomainDeps,
  ctx: CompanyContext,
  input: { name: string },
): Promise<AgentView> {
  assertUser(ctx);
  const id = randomUUID();
  const now = clock.now();
  try {
    await db.insert(agents).values({
      id,
      companyId: ctx.companyId,
      ownerUserId: ctx.userId,
      name: input.name,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
  return findVisibleAgent(db, ctx, id);
}

export function listAgents({ db }: DomainDeps, ctx: CompanyContext): Promise<AgentView[]> {
  return selectAgents(db).where(
    and(
      eq(agents.companyId, ctx.companyId),
      canSeeAllAgents(ctx.role) ? undefined : eq(agents.ownerUserId, ctx.userId),
    ),
  );
}

export async function renameAgent(
  { db, clock }: DomainDeps,
  ctx: CompanyContext,
  agentId: string,
  input: { name: string },
): Promise<AgentView> {
  assertUser(ctx);
  const agent = await findVisibleAgent(db, ctx, agentId);
  if (agent.owner.userId !== ctx.userId) throw forbidden("Only the agent's owner can rename it.");
  try {
    await db
      .update(agents)
      .set({ name: input.name, updatedAt: clock.now() })
      .where(eq(agents.id, agentId));
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
  return findVisibleAgent(db, ctx, agentId);
}

/** Revokes the Agent and every one of its keys. */
export async function revokeAgent(
  { db, clock }: DomainDeps,
  ctx: CompanyContext,
  agentId: string,
): Promise<AgentView> {
  assertUser(ctx);
  const agent = await findVisibleAgent(db, ctx, agentId);
  if (!canRevokeAgent(ctx.role, agent.owner.userId === ctx.userId)) throw forbidden();
  const now = clock.now();
  await db.transaction(async (tx) => {
    await tx
      .update(agents)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(eq(agents.id, agentId), isNull(agents.revokedAt)));
    await tx
      .update(apiKeys)
      .set({ revokedAt: now })
      .where(and(eq(apiKeys.agentId, agentId), isNull(apiKeys.revokedAt)));
  });
  return findVisibleAgent(db, ctx, agentId);
}

const keyColumns = {
  id: apiKeys.id,
  label: apiKeys.label,
  prefix: apiKeys.prefix,
  createdAt: apiKeys.createdAt,
  lastUsedAt: apiKeys.lastUsedAt,
  revokedAt: apiKeys.revokedAt,
};

/** Creates a key for the caller's own Agent. The secret is returned here and never again. */
export async function createApiKey(
  { db, clock }: DomainDeps,
  ctx: CompanyContext,
  agentId: string,
  input: { label: string },
): Promise<{ key: ApiKeyView; secret: string }> {
  assertUser(ctx);
  const agent = await findVisibleAgent(db, ctx, agentId);
  if (agent.owner.userId !== ctx.userId) {
    throw forbidden("Only the agent's owner can create keys for it.");
  }
  if (agent.revokedAt) throw conflict("This agent was revoked.");

  const secret = `${apiKeyPrefix}${randomBytes(32).toString("base64url")}`;
  const [key] = await db
    .insert(apiKeys)
    .values({
      id: randomUUID(),
      agentId,
      label: input.label,
      prefix: secret.slice(0, visiblePrefixLength),
      keyHash: hashApiKey(secret),
      createdAt: clock.now(),
    })
    .returning(keyColumns);
  if (!key) throw new Error("api key insert returned nothing");
  return { key, secret };
}

export async function listApiKeys(
  { db }: DomainDeps,
  ctx: CompanyContext,
  agentId: string,
): Promise<ApiKeyView[]> {
  assertUser(ctx);
  await findVisibleAgent(db, ctx, agentId);
  return db
    .select(keyColumns)
    .from(apiKeys)
    .where(eq(apiKeys.agentId, agentId))
    .orderBy(asc(apiKeys.createdAt));
}

export async function revokeApiKey(
  { db, clock }: DomainDeps,
  ctx: CompanyContext,
  agentId: string,
  keyId: string,
): Promise<ApiKeyView> {
  assertUser(ctx);
  const agent = await findVisibleAgent(db, ctx, agentId);
  if (!canRevokeAgent(ctx.role, agent.owner.userId === ctx.userId)) throw forbidden();
  const [key] = await db
    .update(apiKeys)
    .set({ revokedAt: sql`coalesce(${apiKeys.revokedAt}, ${clock.now()})` })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.agentId, agentId)))
    .returning(keyColumns);
  if (!key) throw notFound();
  return key;
}

/**
 * The member-removed hook that revokes every Agent (and key) the departing
 * User owns in that Company, inside the removal's transaction.
 */
export function revokeAgentsOfRemovedMember(clock: Clock): DomainHooks["memberRemoved"][number] {
  return async (tx, { companyId, userId }) => {
    const now = clock.now();
    const revoked = await tx
      .update(agents)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(agents.companyId, companyId),
          eq(agents.ownerUserId, userId),
          isNull(agents.revokedAt),
        ),
      )
      .returning({ id: agents.id });
    if (revoked.length === 0) return;
    await tx
      .update(apiKeys)
      .set({ revokedAt: now })
      .where(
        and(
          inArray(
            apiKeys.agentId,
            revoked.map((agent) => agent.id),
          ),
          isNull(apiKeys.revokedAt),
        ),
      );
  };
}

export type AgentAuthentication = {
  ctx: CompanyContext;
  keyId: string;
  agent: { id: string; name: string };
};

const lastUsedResolutionMs = 60_000;

/** Records use of a key, writing at most once per minute so not every request writes. */
async function touchApiKey(db: Db, keyId: string, now: Date) {
  const staleBefore = new Date(now.getTime() - lastUsedResolutionMs);
  await db
    .update(apiKeys)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(apiKeys.id, keyId),
        or(isNull(apiKeys.lastUsedAt), lte(apiKeys.lastUsedAt, staleBefore)),
      ),
    );
}

const invalidKey = () => unauthorized("That API key is not valid.");

/**
 * Resolves a bearer API Key to its Agent acting in its Company. The effective
 * Role is the owner's current one, read on every call and never cached.
 */
export async function authenticateApiKey(
  { db, clock }: Pick<DomainDeps, "db" | "clock">,
  secret: string,
): Promise<AgentAuthentication> {
  if (!apiKeyPattern.test(secret)) throw invalidKey();
  const [row] = await db
    .select({
      keyId: apiKeys.id,
      keyRevokedAt: apiKeys.revokedAt,
      agentId: agents.id,
      agentName: agents.name,
      agentRevokedAt: agents.revokedAt,
      companyId: agents.companyId,
      ownerUserId: agents.ownerUserId,
      role: memberships.role,
    })
    .from(apiKeys)
    .innerJoin(agents, eq(agents.id, apiKeys.agentId))
    .leftJoin(
      memberships,
      and(eq(memberships.companyId, agents.companyId), eq(memberships.userId, agents.ownerUserId)),
    )
    .where(eq(apiKeys.keyHash, hashApiKey(secret)));
  if (!row) throw invalidKey();
  // A missing owner Membership means the Agent should already be revoked.
  if (row.agentRevokedAt || !row.role) throw unauthorized("This agent was revoked.");
  if (row.keyRevokedAt) throw unauthorized("This API key was revoked.");
  await touchApiKey(db, row.keyId, clock.now());

  return {
    ctx: {
      actor: { type: "agent", agentId: row.agentId },
      userId: row.ownerUserId,
      companyId: row.companyId,
      role: row.role,
    },
    keyId: row.keyId,
    agent: { id: row.agentId, name: row.agentName },
  };
}

export type Whoami = {
  actor: { type: "user" | "agent"; id: string; name: string };
  /** The User accountable for an Agent; null when a User is acting. */
  owner: { userId: string; name: string; email: string } | null;
  company: { id: string; name: string; role: CompanyContext["role"] };
};

export async function whoami({ db }: DomainDeps, ctx: CompanyContext): Promise<Whoami> {
  const [company] = await db
    .select({ id: schema.companies.id, name: schema.companies.name })
    .from(schema.companies)
    .where(eq(schema.companies.id, ctx.companyId));
  const [user] = await db
    .select({ userId: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, ctx.userId));
  if (!company || !user) throw notFound();
  const scope = { ...company, role: ctx.role };

  if (ctx.actor.type === "user") {
    return {
      actor: { type: "user", id: user.userId, name: user.name },
      owner: null,
      company: scope,
    };
  }
  const [agent] = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(eq(agents.id, ctx.actor.agentId));
  if (!agent) throw notFound();
  return { actor: { type: "agent", ...agent }, owner: user, company: scope };
}
