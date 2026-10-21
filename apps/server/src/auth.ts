import { randomUUID } from "node:crypto";
import { schema } from "@clankerboard/db";
import { type DomainDeps, isSignUpAllowed } from "@clankerboard/domain";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { type AppConfig, enabledOAuthProviders } from "./config";
import type { Logger } from "./logger";

export type AuthDeps = {
  domain: DomainDeps;
  config: AppConfig;
  logger: Logger;
};

/** Invite links carry their token here so sign-up can check it. */
export const inviteTokenHeader = "x-invite-token";
export const inviteTokenCookie = "cb_invite";

function inviteTokenFrom(headers: Headers | undefined) {
  const header = headers?.get(inviteTokenHeader);
  if (header) return header;
  // OAuth sign-ups arrive on a redirect, so the web app leaves the token in a cookie.
  const cookie = headers
    ?.get("cookie")
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === inviteTokenCookie);
  return cookie?.[1] ? decodeURIComponent(cookie[1]) : undefined;
}

export function createAuth({ domain, config, logger }: AuthDeps) {
  const { db } = domain;
  const socialProviders = Object.fromEntries(
    enabledOAuthProviders(config).map((provider) => [provider, config.oauth?.[provider]]),
  );

  return betterAuth({
    baseURL: config.baseUrl,
    basePath: "/api/auth",
    secret: config.authSecret,
    trustedOrigins: [config.baseUrl],
    telemetry: { enabled: false },
    logger: {
      log: (level, message, ...args) => logger[level]({ args }, message),
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        organization: schema.companies,
        member: schema.memberships,
        invitation: schema.invites,
        team: schema.teams,
        teamMember: schema.teamMemberships,
      },
    }),
    advanced: {
      database: { generateId: () => randomUUID() },
    },
    socialProviders,
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    plugins: [
      // Provides the Company, Membership, Team, and Invite tables and the
      // session's active Company. Its HTTP endpoints are not mounted: every
      // tenancy rule lives in the domain module instead (see createApp).
      organization({
        teams: { enabled: true },
        schema: {
          session: { fields: { activeOrganizationId: "activeCompanyId" } },
          // team_memberships.role (lead or member) is ours. Better Auth can't
          // declare extra team member fields, so the column has a default.
          team: { fields: { organizationId: "companyId" } },
          member: { fields: { organizationId: "companyId" } },
          invitation: {
            fields: { organizationId: "companyId" },
            additionalFields: {
              tokenHash: { type: "string", required: true, input: false, returned: false },
              acceptedAt: { type: "date", required: false, input: false },
            },
          },
        },
      }),
    ],
    user: {
      validateUserInfo: async ({ user, source }, ctx) => {
        if (source.action !== "create-user") return;
        const allowed = await isSignUpAllowed(domain, {
          email: String(user.email ?? ""),
          inviteToken: inviteTokenFrom(ctx?.headers),
        });
        if (!allowed) {
          return { error: "SIGN_UP_NEEDS_INVITE", errorDescription: "Sign-up needs an invite." };
        }
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
