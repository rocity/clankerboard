export type AppConfig = {
  /** Public URL of this instance, used to build links. */
  baseUrl: string;
  logLevel: string;
  /** Directory holding the built web app. Unset means the server serves only the API. */
  webDistDir?: string;
};

export type ServerEnv = AppConfig & {
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
    webDistDir: env.WEB_DIST_DIR,
    migrationsDir: env.MIGRATIONS_DIR,
  };
}
