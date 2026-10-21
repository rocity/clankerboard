export type OAuthCredentials = { clientId: string; clientSecret: string };

export const oauthProviders = ["github", "google"] as const;
export type OAuthProvider = (typeof oauthProviders)[number];

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  /** The From address on every email. */
  from: string;
};

export type AppConfig = {
  /** Public URL of this instance, used to build links. */
  baseUrl: string;
  logLevel: string;
  /** Signs session cookies. */
  authSecret: string;
  /** When false, only the first User or someone with an Invite can sign up. */
  openSignup: boolean;
  /** How long an Invite link stays valid. */
  inviteTtlMs: number;
  /** Email is sent only when this is set. */
  smtp?: SmtpConfig;
  /** OAuth providers to offer. A provider is on only when its credentials are present. */
  oauth?: Partial<Record<OAuthProvider, OAuthCredentials>>;
  /** Directory holding the built web app. Unset means the server serves only the API. */
  webDistDir?: string;
};

export type ServerEnv = Omit<AppConfig, "authSecret"> & {
  /** Unset means the app generates one and keeps it in the database. */
  authSecret?: string;
  port: number;
  databaseUrl: string;
  migrationsDir?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv): ServerEnv {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const port = Number(env.PORT ?? 3000);
  return {
    port,
    databaseUrl,
    baseUrl: env.BASE_URL ?? `http://localhost:${port}`,
    logLevel: env.LOG_LEVEL ?? "info",
    authSecret: env.AUTH_SECRET || undefined,
    openSignup: env.OPEN_SIGNUP === "true",
    inviteTtlMs: Number(env.INVITE_TTL_HOURS ?? 7 * 24) * 60 * 60 * 1000,
    smtp: env.SMTP_HOST
      ? {
          host: env.SMTP_HOST,
          port: Number(env.SMTP_PORT ?? 587),
          secure: env.SMTP_SECURE === "true",
          user: env.SMTP_USER || undefined,
          password: env.SMTP_PASSWORD || undefined,
          from:
            env.SMTP_FROM ||
            `Clankerboard <no-reply@${new URL(env.BASE_URL || "http://localhost").hostname}>`,
        }
      : undefined,
    oauth: {
      github: credentials(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
      google: credentials(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    },
    webDistDir: env.WEB_DIST_DIR,
    migrationsDir: env.MIGRATIONS_DIR,
  };
}

function credentials(clientId?: string, clientSecret?: string): OAuthCredentials | undefined {
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

export function enabledOAuthProviders(config: AppConfig): OAuthProvider[] {
  return oauthProviders.filter((provider) => config.oauth?.[provider]);
}
