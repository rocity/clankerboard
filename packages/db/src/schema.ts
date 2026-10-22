import {
  companyRoles,
  teamRoles,
  ticketLinkKinds,
  ticketPriorities,
  ticketStatuses,
  ticketTypes,
} from "@agentkanban/shared";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Better Auth owns these tables (ADR-0005). Property names follow Better Auth's
// field names so its Drizzle adapter can read and write them. Its schema check
// rejects missing or unknown columns: read docs/better-auth.md before changing one.

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable("users", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  ...timestamps,
});

export const sessions = pgTable(
  "sessions",
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The Company this session is working in. Better Auth's organization
    // plugin calls it activeOrganizationId; we rename it in the auth config.
    activeCompanyId: text().references(() => companies.id, { onDelete: "set null" }),
    // Required by Better Auth's team support. Unused: nothing sets an active Team.
    activeTeamId: text(),
    ...timestamps,
  },
  (t) => [index().on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    ...timestamps,
  },
  (t) => [index().on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index().on(t.identifier)],
);

// A Company is a Better Auth organization.
export const companies = pgTable("companies", {
  id: text().primaryKey(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  logo: text(),
  metadata: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// A User's Membership in a Company: Better Auth's organization member.
export const memberships = pgTable(
  "memberships",
  {
    id: text().primaryKey(),
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text({ enum: companyRoles }).notNull().default("member"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.companyId, t.userId), index().on(t.userId)],
);

export const inviteStatuses = ["pending", "accepted", "revoked"] as const;

// An offer to join a Company: Better Auth's organization invitation, extended
// with a hashed single-use token. "Expired" is a pending Invite past expiresAt.
export const invites = pgTable(
  "invites",
  {
    id: text().primaryKey(),
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    email: text().notNull(),
    role: text({ enum: companyRoles }).notNull().default("member"),
    status: text({ enum: inviteStatuses }).notNull().default("pending"),
    /** SHA-256 of the link token. The token itself is never stored. */
    tokenHash: text().notNull().unique(),
    /** Set for a Team Invite. */
    teamId: text().references(() => teams.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    inviterId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.companyId), index().on(t.email)],
);

// A Team is a Better Auth organization team.
export const teams = pgTable(
  "teams",
  {
    id: text().primaryKey(),
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text().notNull(),
    // Better Auth's own team endpoints maintain this; they are not mounted, so
    // it stays at its default. Count team_memberships instead.
    memberCount: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex("teams_company_id_name_unique").on(t.companyId, sql`lower(${t.name})`)],
);

// Better Auth's team member, extended with a Team Role.
export const teamMemberships = pgTable(
  "team_memberships",
  {
    id: text().primaryKey(),
    teamId: text()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text({ enum: teamRoles }).notNull().default("member"),
    membershipKey: text().unique(),
    createdAt: timestamp({ withTimezone: true }).defaultNow(),
  },
  (t) => [unique().on(t.teamId, t.userId), index().on(t.userId)],
);

// Our own tables from here on, not Better Auth's (ADR-0003, ADR-0005).

// A non-human Actor owned by a User within one Company.
export const agents = pgTable(
  "agents",
  {
    id: text().primaryKey(),
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // Restrict, not cascade: an Agent stays the author of its past work, so
    // deleting its owner must not erase it.
    ownerUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    name: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("agents_company_id_name_unique").on(t.companyId, sql`lower(${t.name})`),
    index().on(t.ownerUserId),
  ],
);

// A secret credential belonging to an Agent. Only its SHA-256 hash is stored.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text().primaryKey(),
    // Restrict, like every reference to an Agent: Agents are revoked, never deleted.
    agentId: text()
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    label: text().notNull(),
    /** The start of the key, safe to show, such as `cb_Ab12Cd34`. */
    prefix: text().notNull(),
    keyHash: text().notNull().unique(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.agentId)],
);

// Board tables (Spec 03).

// A container of Tickets. Its key is fixed once created, since Ticket Keys
// like CB-42 end up in commits and transcripts.
export const projects = pgTable(
  "projects",
  {
    id: text().primaryKey(),
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    teamId: text().references(() => teams.id, { onDelete: "set null" }),
    name: text().notNull(),
    key: text().notNull(),
    /** The number the next Ticket gets. Never goes back, so numbers are never reused. */
    nextTicketNumber: integer().notNull().default(1),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.companyId, t.key), index().on(t.teamId)],
);

export const ticketType = pgEnum("ticket_type", ticketTypes);
export const ticketStatus = pgEnum("ticket_status", ticketStatuses);
export const ticketPriority = pgEnum("ticket_priority", ticketPriorities);

// An Actor reference is a pair of nullable columns, one for a User and one for
// an Agent. Restrict on delete so history is never erased with its Actor.
const actorUser = () => text().references(() => users.id, { onDelete: "restrict" });
const actorAgent = () => text().references(() => agents.id, { onDelete: "restrict" });

/**
 * Fractional-index keys compare by byte ("aZ" before "aa"). Without the C
 * collation, Postgres on most hosts sorts them by language rules instead.
 */
const rankText = customType<{ data: string }>({ dataType: () => 'text COLLATE "C"' });

/** Postgres full-text search vector. */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const tickets = pgTable(
  "tickets",
  {
    id: text().primaryKey(),
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    /** Always in the same Project. Hierarchy rules live in the domain module. */
    parentId: text().references((): AnyPgColumn => tickets.id, { onDelete: "set null" }),
    title: text().notNull(),
    description: text().notNull().default(""),
    type: ticketType().notNull(),
    status: ticketStatus().notNull().default("backlog"),
    priority: ticketPriority().notNull().default("medium"),
    /** Points from 0 to 100. Null means blank (not sized), which is distinct from 0. */
    estimate: integer(),
    /** Fractional-index position within the Ticket's Status column. */
    rank: rankText().notNull(),
    assigneeUserId: actorUser(),
    assigneeAgentId: actorAgent(),
    createdByUserId: actorUser(),
    createdByAgentId: actorAgent(),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Maintained by Postgres from title and description. Never select it. */
    search: tsvector().generatedAlwaysAs(
      sql`to_tsvector('english', "title" || ' ' || "description")`,
    ),
  },
  (t) => [
    unique().on(t.projectId, t.number),
    index("tickets_search_index").using("gin", t.search),
    index().on(t.projectId, t.status, t.rank),
    index().on(t.parentId),
    check(
      "tickets_one_assignee",
      sql`num_nonnulls(${t.assigneeUserId}, ${t.assigneeAgentId}) <= 1`,
    ),
    check(
      "tickets_one_creator",
      sql`num_nonnulls(${t.createdByUserId}, ${t.createdByAgentId}) = 1`,
    ),
    check("tickets_estimate_range", sql`${t.estimate} between 0 and 100`),
  ],
);

export const ticketLinkKind = pgEnum("ticket_link_kind", ticketLinkKinds);

// A connection between two Tickets other than Parent (Spec 07). For Blocks,
// "from" blocks "to". Relates to is symmetric and stored once per pair. The
// Ticket Links domain module owns the rules; Blocked is derived from these rows.
export const ticketLinks = pgTable(
  "ticket_links",
  {
    id: text().primaryKey(),
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // Cascade, so hard-deleting a Ticket removes its Links.
    fromTicketId: text()
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    toTicketId: text()
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    kind: ticketLinkKind().notNull(),
    createdByUserId: actorUser(),
    createdByAgentId: actorAgent(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One Link per pair of Tickets, whatever its kind or direction.
    uniqueIndex("ticket_links_pair_unique").on(
      sql`least(${t.fromTicketId}, ${t.toTicketId})`,
      sql`greatest(${t.fromTicketId}, ${t.toTicketId})`,
    ),
    index().on(t.fromTicketId),
    index().on(t.toTicketId),
    check("ticket_links_not_self", sql`${t.fromTicketId} <> ${t.toTicketId}`),
    check(
      "ticket_links_one_creator",
      sql`num_nonnulls(${t.createdByUserId}, ${t.createdByAgentId}) = 1`,
    ),
  ],
);

// Markdown an Actor writes on a Ticket. Append-only in v1.
export const comments = pgTable(
  "comments",
  {
    id: text().primaryKey(),
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    ticketId: text()
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    authorUserId: actorUser(),
    authorAgentId: actorAgent(),
    body: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.ticketId),
    check("comments_one_author", sql`num_nonnulls(${t.authorUserId}, ${t.authorAgentId}) = 1`),
  ],
);

// A recorded event on the board, credited to the Actor who caused it. The id
// only ever increases; Spec 05 uses it as the SSE event id.
export const activities = pgTable(
  "activities",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ticketId: text().references(() => tickets.id, { onDelete: "cascade" }),
    actorUserId: actorUser(),
    actorAgentId: actorAgent(),
    kind: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.ticketId, t.id),
    index().on(t.companyId, t.id),
    check("activities_one_actor", sql`num_nonnulls(${t.actorUserId}, ${t.actorAgentId}) = 1`),
  ],
);

// Instance-wide values the app generates for itself, such as the auth secret
// when the operator does not set one.
export const instanceSettings = pgTable("instance_settings", {
  key: text().primaryKey(),
  value: text().notNull(),
});
