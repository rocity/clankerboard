import { companyRoles, teamRoles } from "@clankerboard/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
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
    ownerUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
    agentId: text()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
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

// Instance-wide values the app generates for itself, such as the auth secret
// when the operator does not set one.
export const instanceSettings = pgTable("instance_settings", {
  key: text().primaryKey(),
  value: text().notNull(),
});
