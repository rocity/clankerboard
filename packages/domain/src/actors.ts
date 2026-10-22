import { type Db, schema, type Tx } from "@agentkanban/db";
import type { ActorView } from "@agentkanban/shared";
import { asc, eq, inArray } from "drizzle-orm";
import type { Actor, CompanyContext, DomainDeps } from "./context";

/** A pointer to an Actor, as stored in a pair of User and Agent columns. */
export type ActorRef = { type: "user" | "agent"; id: string };

/** An Actor as the API shows it. */
export type { ActorView };

export function refOf(actor: Actor): ActorRef {
  return actor.type === "user"
    ? { type: "user", id: actor.userId }
    : { type: "agent", id: actor.agentId };
}

/** Splits a ref into the User and Agent column values. */
export function actorColumns(ref: ActorRef | null) {
  return {
    userId: ref?.type === "user" ? ref.id : null,
    agentId: ref?.type === "agent" ? ref.id : null,
  };
}

export function refFromColumns(userId: string | null, agentId: string | null): ActorRef | null {
  if (userId) return { type: "user", id: userId };
  if (agentId) return { type: "agent", id: agentId };
  return null;
}

export function sameActor(a: ActorRef | null, b: ActorRef | null) {
  return a?.type === b?.type && a?.id === b?.id;
}

const keyOf = (ref: ActorRef) => `${ref.type}:${ref.id}`;

/** Looks up names for many Actors in two queries. */
export async function resolveActors(db: Db | Tx, refs: (ActorRef | null)[]) {
  const present = refs.filter((ref): ref is ActorRef => ref !== null);
  const userIds = [...new Set(present.filter((r) => r.type === "user").map((r) => r.id))];
  const agentIds = [...new Set(present.filter((r) => r.type === "agent").map((r) => r.id))];
  const views = new Map<string, ActorView>();
  if (userIds.length > 0) {
    const rows = await db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(inArray(schema.users.id, userIds));
    for (const row of rows) views.set(`user:${row.id}`, { type: "user", ...row, revoked: false });
  }
  if (agentIds.length > 0) {
    const rows = await db
      .select({
        id: schema.agents.id,
        name: schema.agents.name,
        revokedAt: schema.agents.revokedAt,
      })
      .from(schema.agents)
      .where(inArray(schema.agents.id, agentIds));
    for (const { revokedAt, ...row } of rows) {
      views.set(`agent:${row.id}`, { type: "agent", ...row, revoked: revokedAt !== null });
    }
  }
  return (ref: ActorRef | null): ActorView | null => {
    if (!ref) return null;
    const view = views.get(keyOf(ref));
    if (!view) throw new Error(`actor ${keyOf(ref)} not found`);
    return view;
  };
}

/**
 * Every User and Agent of the Company, by name and kind only, for assignee
 * pickers and filters. Any Role may read it, and so may an Agent: the board
 * already shows every Assignee, and no email or owner is exposed. Revoked
 * Agents stay, marked revoked, because Tickets they held still name them.
 */
export async function listActors({ db }: DomainDeps, ctx: CompanyContext): Promise<ActorView[]> {
  const { users, memberships, agents } = schema;
  const members = await db
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.companyId, ctx.companyId))
    .orderBy(asc(users.name), asc(users.id));
  const companyAgents = await db
    .select({ id: agents.id, name: agents.name, revokedAt: agents.revokedAt })
    .from(agents)
    .where(eq(agents.companyId, ctx.companyId))
    .orderBy(asc(agents.name), asc(agents.id));
  return [
    ...members.map((u): ActorView => ({ type: "user", ...u, revoked: false })),
    ...companyAgents.map(
      ({ revokedAt, ...a }): ActorView => ({ type: "agent", ...a, revoked: revokedAt !== null }),
    ),
  ];
}
