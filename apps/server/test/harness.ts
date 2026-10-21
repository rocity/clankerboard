import type { Database } from "@clankerboard/db";
import type { Clock, Mailer, MailMessage } from "@clankerboard/domain";
import { type AppConfig, type AppDeps, createApp } from "../src/index";
import { createLogger } from "../src/logger";

export const baseUrl = "http://localhost:3000";

export function testDatabase(): Database {
  const database = (globalThis as { __cbTestDatabase?: Database }).__cbTestDatabase;
  if (!database) throw new Error("worker-setup did not run");
  return database;
}

export class FakeClock implements Clock {
  constructor(private current = new Date("2026-01-01T00:00:00.000Z")) {}
  now() {
    return new Date(this.current);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class CapturingMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage) {
    this.sent.push(message);
  }
}

export type TestApp = ReturnType<typeof buildTestApp>;

export function buildTestApp(
  overrides: { config?: Partial<AppConfig>; deps?: Partial<AppDeps> } = {},
) {
  const clock = new FakeClock();
  const mailer = new CapturingMailer();
  const config: AppConfig = {
    baseUrl,
    logLevel: "silent",
    ...overrides.config,
  };
  const app = createApp({
    db: testDatabase().db,
    clock,
    mailer,
    config,
    logger: createLogger("silent"),
    ...overrides.deps,
  });

  function request(path: string, init: RequestInit = {}) {
    return app.request(new URL(path, baseUrl), init);
  }

  return { app, clock, mailer, config, request };
}
