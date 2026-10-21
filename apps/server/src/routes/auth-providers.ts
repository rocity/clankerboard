import { Hono } from "hono";
import { type AppConfig, enabledOAuthProviders } from "../config";
import type { AppEnv } from "../env";

/** Public: lets the sign-in screen render only the OAuth buttons that work. */
export function authProviderRoutes(config: AppConfig) {
  const providers = enabledOAuthProviders(config);
  return new Hono<AppEnv>().get("/auth-providers", (c) => c.json({ providers }));
}
