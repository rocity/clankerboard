import type { Database } from "@clankerboard/db";
import type { Clock, Mailer, MailMessage } from "@clankerboard/domain";
import type { CompanyRole } from "@clankerboard/shared";
import { pino } from "pino";
import { type AppConfig, type AppDeps, createApp } from "../src/index";
import { createLogger } from "../src/logger";

export const baseUrl = "http://localhost:3000";

// Unhandled errors reach stderr so a bare 500 still shows its cause.
// CB_TEST_LOG=debug shows everything; CB_TEST_LOG=silent hides it all.
const testLogger = createLogger(
  process.env.CB_TEST_LOG ?? "error",
  pino.destination({ fd: 2, sync: true }),
);
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
    return true;
  }
}

/** True when text follows the user-facing copy rule's mechanical parts. */
export function plainCopy(text: string) {
  return !text.includes("—") && !/\p{Extended_Pictographic}/u.test(text);
}

export type Fetch = (path: string, init?: RequestInit) => Promise<Response>;

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
    inviteTtlMs: 7 * 24 * 60 * 60 * 1000,
    rateLimit: { capacity: 1000, refillPerSecond: 1000 },
    ...overrides.config,
  };
  const app = createApp({
    db: testDatabase().db,
    clock,
    mailer,
    config,
    logger: testLogger,
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

  /** Requests made with `Authorization: Bearer <secret>`, as an Agent would. */
  function bearer(secret: string): Fetch {
    return (path, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${secret}`);
      if (init.body && !headers.has("content-type"))
        headers.set("content-type", "application/json");
      return Promise.resolve(app.request(new URL(path, baseUrl), { ...init, headers }));
    };
  }

  return { app, clock, mailer, config, request, requestAs, bearer, signUp, signIn };
}

export type CompanyFixture = {
  company: { id: string; name: string; slug: string };
  owner: SignedInUser;
  members: SignedInUser[];
};

let fixtureCount = 0;

/**
 * Creates a Company through the API, owned by `owner` (or a fresh User), and
 * adds the given members with their Roles. Each member's active Company is
 * set to it.
 */
export async function createCompany(
  t: TestApp,
  input: {
    name: string;
    slug?: string;
    owner?: SignedInUser;
    members?: { email: string; role: CompanyRole }[];
  },
): Promise<CompanyFixture> {
  const owner = input.owner ?? (await t.signUp({ email: `owner-${++fixtureCount}@example.com` }));
  const res = await owner.request("/api/companies", {
    method: "POST",
    body: JSON.stringify({ name: input.name, slug: input.slug }),
  });
  if (res.status !== 201) throw new Error(`createCompany failed: ${await res.text()}`);
  const { company } = (await res.json()) as CompanyFixture;

  const members: SignedInUser[] = [];
  for (const member of input.members ?? []) {
    members.push(await joinCompany(t, owner, member));
  }
  return { company, owner, members };
}

/** The token part of an Invite link. */
export function tokenFrom(link: string) {
  return new URL(link).hash.slice(1);
}

/**
 * Brings a new User into the inviter's active Company through an Invite, and
 * leaves that Company active for them.
 */
export async function joinCompany(
  t: TestApp,
  inviter: SignedInUser,
  input: { email: string; role: CompanyRole },
): Promise<SignedInUser> {
  const res = await inviter.request("/api/invites", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (res.status !== 201) throw new Error(`invite failed: ${await res.text()}`);
  const { link } = (await res.json()) as { link: string };
  const token = tokenFrom(link);
  const user = await t.signUp({ email: input.email }, { headers: { "x-invite-token": token } });
  const accepted = await user.request("/api/invite-links/accept", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  if (accepted.status !== 200) throw new Error(`accept failed: ${await accepted.text()}`);
  return user;
}

export type AgentFixture = { id: string; name: string };

/** Creates an Agent owned by `owner` in their active Company. */
export async function createAgent(owner: SignedInUser, name: string): Promise<AgentFixture> {
  const res = await owner.request("/api/agents", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (res.status !== 201) throw new Error(`createAgent failed: ${await res.text()}`);
  return ((await res.json()) as { agent: AgentFixture }).agent;
}

/** Creates an API Key for the owner's Agent and a client that uses it. */
export async function createApiKey(
  t: TestApp,
  owner: SignedInUser,
  agentId: string,
  label = "test",
) {
  const res = await owner.request(`/api/agents/${agentId}/keys`, {
    method: "POST",
    body: JSON.stringify({ label }),
  });
  if (res.status !== 201) throw new Error(`createApiKey failed: ${await res.text()}`);
  const { key, secret } = (await res.json()) as {
    key: { id: string; prefix: string };
    secret: string;
  };
  return { key, secret, bearer: t.bearer(secret) };
}
