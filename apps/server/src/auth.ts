import { randomUUID } from "node:crypto";
import { type Db, schema } from "@clankerboard/db";
import { isSignUpAllowed } from "@clankerboard/domain";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { AppConfig } from "./config";
import type { Logger } from "./logger";

export type AuthDeps = {
  db: Db;
  config: AppConfig;
  logger: Logger;
};

export function createAuth({ db, config, logger }: AuthDeps) {
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
      },
    }),
    advanced: {
      database: { generateId: () => randomUUID() },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    user: {
      validateUserInfo: async ({ user, source }) => {
        if (source.action !== "create-user") return;
        const allowed = await isSignUpAllowed(db, config, { email: String(user.email ?? "") });
        if (!allowed) {
          return { error: "SIGN_UP_NEEDS_INVITE", errorDescription: "Sign-up needs an invite." };
        }
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
