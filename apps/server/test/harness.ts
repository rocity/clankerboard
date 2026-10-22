import type { Database } from "@clankerboard/db";
import {
  type ActivityEvent,
  type Clock,
  InProcessEventBus,
  type Mailer,
  type MailMessage,
  type TicketView,
} from "@clankerboard/domain";
import type { CompanyRole } from "@clankerboard/shared";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
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

type FakeTimer = { due: number; ms: number; callback: () => void };

/** A clock that moves only when told. `advance` fires each timer that comes due, in order. */
export class FakeClock implements Clock {
  private readonly timers = new Set<FakeTimer>();

  constructor(private current = new Date("2026-01-01T00:00:00.000Z")) {}
  now() {
    return new Date(this.current);
  }
  every(ms: number, callback: () => void) {
    const timer = { due: this.current.getTime() + ms, ms, callback };
    this.timers.add(timer);
    return () => {
      this.timers.delete(timer);
    };
  }
  advance(ms: number) {
    const target = this.current.getTime() + ms;
    for (;;) {
      const [next] = [...this.timers].filter((t) => t.due <= target).sort((a, b) => a.due - b.due);
      if (!next) break;
      this.current = new Date(next.due);
      next.due += next.ms;
      next.callback();
    }
    this.current = new Date(target);
  }
}

export class CapturingMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage) {
    this.sent.push(message);
    return true;
  }
}

/**
 * An in-process bus that also captures published Activity. Set `probe` to run
 * a check at the moment each event is published, such as asking the API
 * whether the change is visible yet.
 */
export class CapturingEventBus extends InProcessEventBus {
  readonly published: ActivityEvent[] = [];
  probe?: (event: ActivityEvent) => Promise<boolean>;
  private readonly results: Promise<boolean>[] = [];

  override publish(event: ActivityEvent) {
    this.published.push(event);
    if (this.probe) this.results.push(this.probe(event));
    super.publish(event);
  }

  probeResults() {
    return Promise.all(this.results);
  }
}

/** One message read off an SSE stream: an event, a bare `retry:`, or a comment. */
export type StreamMessage = {
  id?: string;
  event?: string;
  data?: string;
  retry?: number;
  comment?: string;
};

export type OpenStream = {
  response: Response;
  /** The next message, or `null` once the stream has ended. */
  next(): Promise<StreamMessage | null>;
  /** The next message that is an event, skipping retry and comment messages. */
  nextEvent(): Promise<StreamMessage & { id: string; event: string; data: string }>;
  close(): Promise<void>;
};

function parseStreamMessage(block: string): StreamMessage {
  const message: StreamMessage = {};
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) {
      message.comment = line.slice(1).trim();
      continue;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "id") message.id = value;
    else if (field === "event") message.event = value;
    else if (field === "data") data.push(value);
    else if (field === "retry") message.retry = Number(value);
  }
  if (data.length > 0) message.data = data.join("\n");
  return message;
}

/** Opens the live stream as any caller and reads it message by message. */
export async function openStream(as: Fetch, init: RequestInit = {}): Promise<OpenStream> {
  const response = await as("/api/stream", init);
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";

  async function next(): Promise<StreamMessage | null> {
    if (!reader) return null;
    for (;;) {
      const end = buffered.indexOf("\n\n");
      if (end !== -1) {
        const block = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        return parseStreamMessage(block);
      }
      const { done, value } = await reader.read();
      if (done) return null;
      buffered += value;
    }
  }

  async function nextEvent() {
    for (;;) {
      const message = await next();
      if (!message) throw new Error("the stream ended before the next event");
      if (message.id !== undefined && message.event !== undefined && message.data !== undefined) {
        return message as StreamMessage & { id: string; event: string; data: string };
      }
    }
  }

  return { response, next, nextEvent, close: async () => reader?.cancel() };
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
    boardDoneWindowMs: 14 * 24 * 60 * 60 * 1000,
    streamBacklogLimit: 500,
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

  /**
   * A real MCP SDK client connected to `/mcp` with the given API Key, over a
   * transport whose fetch is the in-process app. `modern` speaks the
   * 2026-07-28 revision; the default is the 2025 handshake most clients use.
   */
  async function mcpClient(secret: string, { modern = false } = {}) {
    const client = new Client(
      { name: "clankerboard-test", version: "0.0.0" },
      { versionNegotiation: { mode: modern ? "auto" : "legacy" } },
    );
    const transport = new StreamableHTTPClientTransport(new URL("/mcp", baseUrl), {
      fetch: (url, init) => Promise.resolve(app.request(new Request(url, init))),
      requestInit: { headers: { authorization: `Bearer ${secret}` } },
    });
    await client.connect(transport);
    return client;
  }

  return { app, clock, mailer, config, request, requestAs, bearer, signUp, signIn, mcpClient };
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

export type ActivityJson = {
  type: "activity";
  id: number;
  kind: string;
  actor: { type: string; id: string; name: string };
  payload: Record<string, unknown>;
};

/** The Activity entries of a Ticket's timeline, oldest first. Comments are left out. */
export async function activityOf(as: Fetch, key: string): Promise<ActivityJson[]> {
  const res = await as(`/api/tickets/${key}/timeline`);
  if (res.status !== 200) throw new Error(`timeline failed: ${await res.text()}`);
  const { timeline } = (await res.json()) as { timeline: { type: string }[] };
  return timeline.filter((item): item is ActivityJson => item.type === "activity");
}

/** Creates a Project as any caller, session or bearer. */
export async function createProject(
  as: Fetch,
  input: { name: string; key: string; teamId?: string },
) {
  const res = await as("/api/projects", { method: "POST", body: JSON.stringify(input) });
  if (res.status !== 201) throw new Error(`createProject failed: ${await res.text()}`);
  return ((await res.json()) as { project: { id: string; key: string } }).project;
}

type TicketJson = Omit<TicketView, "createdAt" | "updatedAt" | "archivedAt"> & {
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

/** Creates a Ticket as any caller. The type defaults to task. */
export async function createTicket(
  as: Fetch,
  input: { projectKey: string; title: string; type?: string } & Record<string, unknown>,
): Promise<TicketJson> {
  const res = await as("/api/tickets", {
    method: "POST",
    body: JSON.stringify({ type: "task", ...input }),
  });
  if (res.status !== 201) throw new Error(`createTicket failed: ${await res.text()}`);
  return ((await res.json()) as { ticket: TicketJson }).ticket;
}
