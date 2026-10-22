import { productName } from "@agentkanban/shared";
import type { RateLimitConfig } from "./rate-limit";

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
  /** How long a Done Ticket stays on the MCP board resource after its last change. */
  boardDoneWindowMs: number;
  /** Most Activity a reconnecting live stream replays. Past it, the stream sends `resync`. */
  streamBacklogLimit: number;
  /** Email is sent only when this is set. */
  smtp?: SmtpConfig;
  /** Per-API-Key request budget. Session requests are not limited. */
  rateLimit: RateLimitConfig;
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
  const port = numberFrom(env, "PORT", 3000, { min: 1, integer: true });
  return {
    port,
    databaseUrl,
    baseUrl: env.BASE_URL ?? `http://localhost:${port}`,
    logLevel: env.LOG_LEVEL ?? "info",
    authSecret: env.AUTH_SECRET || undefined,
    openSignup: env.OPEN_SIGNUP === "true",
    inviteTtlMs: numberFrom(env, "INVITE_TTL_HOURS", 7 * 24, { min: 1 }) * 60 * 60 * 1000,
    boardDoneWindowMs:
      numberFrom(env, "BOARD_DONE_WINDOW_DAYS", 14, { min: 0 }) * 24 * 60 * 60 * 1000,
    streamBacklogLimit: numberFrom(env, "STREAM_BACKLOG_LIMIT", 500, { min: 0, integer: true }),
    rateLimit: {
      // Under 1 would turn every request away.
      capacity: numberFrom(env, "RATE_LIMIT_CAPACITY", 120, { min: 1 }),
      refillPerSecond: numberFrom(env, "RATE_LIMIT_REFILL_PER_SECOND", 2, { min: 0.001 }),
    },
    smtp: env.SMTP_HOST
      ? {
          host: env.SMTP_HOST,
          port: numberFrom(env, "SMTP_PORT", 587, { min: 1, integer: true }),
          secure: env.SMTP_SECURE === "true",
          user: env.SMTP_USER || undefined,
          password: env.SMTP_PASSWORD || undefined,
          from:
            env.SMTP_FROM ||
            `${productName} <no-reply@${new URL(env.BASE_URL || "http://localhost").hostname}>`,
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

/** Reads a numeric env var, failing at startup on a value the app can't run with. */
function numberFrom(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  rule: { min: number; integer?: boolean },
) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < rule.min || (rule.integer && !Number.isInteger(value))) {
    const kind = rule.integer ? "a whole number" : "a number";
    throw new Error(`${name} must be ${kind} of at least ${rule.min}, got "${raw}"`);
  }
  return value;
}

function credentials(clientId?: string, clientSecret?: string): OAuthCredentials | undefined {
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

export function enabledOAuthProviders(config: AppConfig): OAuthProvider[] {
  return oauthProviders.filter((provider) => config.oauth?.[provider]);
}
