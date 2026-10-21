import type { Database } from "@clankerboard/db";
import type { Clock, Mailer, MailMessage } from "@clankerboard/domain";
import { type AppConfig, type AppDeps, createApp } from "../src/index";
import { createLogger } from "../src/logger";

export const baseUrl = "http://localhost:3000";
export const defaultPassword = "correct-horse-battery";

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

/** True when text follows the user-facing copy rule's mechanical parts. */
export function plainCopy(text: string) {
  return !text.includes("—") && !/\p{Extended_Pictographic}/u.test(text);
}

type Fetch = (path: string, init?: RequestInit) => Promise<Response>;

export type SignedInUser = {
  user: { id: string; email: string; name: string };
  cookie: string;
  request: Fetch;
};

export type TestApp = ReturnType<typeof buildTestApp>;

export function buildTestApp(
  overrides: { config?: Partial<AppConfig>; deps?: Partial<AppDeps> } = {},
) {
  const clock = new FakeClock();
  const mailer = new CapturingMailer();
  const config: AppConfig = {
    baseUrl,
    logLevel: "silent",
    authSecret: "test-secret-test-secret-test-secret",
    openSignup: true,
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

  function requestAs(cookie: string | undefined): Fetch {
    return (path, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("origin", baseUrl);
      if (init.body && !headers.has("content-type"))
        headers.set("content-type", "application/json");
      if (cookie) headers.set("cookie", cookie);
      return Promise.resolve(app.request(new URL(path, baseUrl), { ...init, headers }));
    };
  }

  const request = requestAs(undefined);

  async function session(res: Response): Promise<SignedInUser> {
    if (res.status !== 200) {
      throw new Error(`auth failed with ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { user: SignedInUser["user"] };
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    return { user: body.user, cookie, request: requestAs(cookie) };
  }

  async function signUp(
    input: { email: string; name?: string; password?: string },
    init: RequestInit = {},
  ) {
    const res = await request("/api/auth/sign-up/email", {
      ...init,
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        name: input.name ?? input.email.split("@")[0],
        password: input.password ?? defaultPassword,
      }),
    });
    return session(res);
  }

  async function signIn(input: { email: string; password?: string }) {
    const res = await request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: input.email, password: input.password ?? defaultPassword }),
    });
    return session(res);
  }

  return { app, clock, mailer, config, request, requestAs, signUp, signIn };
}
