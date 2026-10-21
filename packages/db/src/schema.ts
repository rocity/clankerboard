import { companyRoles } from "@clankerboard/shared";
import { boolean, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

// Better Auth owns these tables (ADR-0005). Property names follow Better Auth's
// field names so its Drizzle adapter can read and write them.

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
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    inviterId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.companyId), index().on(t.email)],
);

// Instance-wide values the app generates for itself, such as the auth secret
// when the operator does not set one.
export const instanceSettings = pgTable("instance_settings", {
  key: text().primaryKey(),
  value: text().notNull(),
});
