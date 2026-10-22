import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  type APIRequestContext,
  type Browser,
  expect,
  type Locator,
  type Page,
  request,
  test,
} from "@playwright/test";

export const password = "correct-horse-battery";

/** Signs up through the sign-up screen and waits until the app has left it. */
export async function signUp(page: Page, name: string, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).not.toHaveURL(/\/sign-up/);
}

export async function signIn(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

type CompanyRow = { id: string; name: string; slug: string; role: string };

/** Creates a Company as the signed-in User. It becomes their session's active Company. */
export async function createCompany(page: Page, name: string) {
  const res = await page.request.post("/api/companies", { data: { name } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { company: CompanyRow }).company;
}

export async function companies(page: Page) {
  const res = await page.request.get("/api/companies");
  return (await res.json()) as { companies: CompanyRow[]; activeCompanyId: string | null };
}

type InviteRow = { id: string; email: string; role: string; status: string };

/** Creates an Invite over HTTP as the signed-in User, for tests that do not exercise the Invite form. */
export async function inviteByApi(
  page: Page,
  email: string,
  options: { role?: string; teamId?: string } = {},
) {
  const res = await page.request.post("/api/invites", { data: { email, ...options } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { invite: InviteRow; link: string };
}

/**
 * Opens a fresh browser context for a new User and joins them to the Company through an
 * Invite link, over HTTP. The returned page is signed in with that Company active.
 */
export async function joinByApi(
  browser: Browser,
  like: Page,
  link: string,
  user: { name: string; email: string },
) {
  const origin = new URL(link).origin;
  const token = link.split("#")[1] ?? "";
  const dark = await like.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const context = await browser.newContext({
    viewport: like.viewportSize(),
    colorScheme: dark ? "dark" : "light",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const signUpRes = await context.request.post(`${origin}/api/auth/sign-up/email`, {
    data: { ...user, password },
    headers: { origin, "x-invite-token": token },
  });
  expect(signUpRes.status()).toBe(200);
  const acceptRes = await context.request.post(`${origin}/api/invite-links/accept`, {
    data: { token },
    headers: { origin },
  });
  expect(acceptRes.status()).toBe(200);
  return { context, page: await context.newPage() };
}

/**
 * Invites `email` to the signed-in User's active Company, then signs them up in a
 * fresh browser context that matches the running project's viewport and theme.
 */
export async function joinCompany(
  owner: Page,
  browser: Browser,
  invitee: { name: string; email: string; role?: "member" | "admin" },
) {
  const res = await owner.request.post("/api/invites", {
    data: { email: invitee.email, role: invitee.role ?? "member" },
  });
  expect(res.status()).toBe(201);
  const { link } = (await res.json()) as { link: string };

  const { viewport, colorScheme, hasTouch } = test.info().project.use;
  const context = await browser.newContext({ viewport, colorScheme, hasTouch });
  const page = await context.newPage();
  await page.goto(link);
  await page.getByLabel("Name").fill(invitee.name);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).not.toHaveURL(/\/invite/);
  return page;
}

/** True when the page scrolls sideways, which breaks the mobile layout. */
export function scrollsSideways(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

/** The box of an element once its animations have finished, so a dialog's zoom-in is not measured. */
export async function settledBox(locator: Locator) {
  await locator.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const dialog = locator.page().getByRole("dialog");
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return locator.boundingBox();
}

async function post<T>(page: Page, path: string, data: object, status = 201): Promise<T> {
  const res = await page.request.post(path, { data });
  expect(res.status(), `${path}: ${await res.text()}`).toBe(status);
  return (await res.json()) as T;
}

export type TicketRow = {
  key: string;
  title: string;
  status: string;
  rank: string;
  assignee: { type: string; id: string; name: string } | null;
};

/** Creates a Team in the active Company. */
export async function createTeam(page: Page, name: string) {
  return (await post<{ team: { id: string; name: string } }>(page, "/api/teams", { name })).team;
}

type TeamMemberRow = { userId: string; email: string; role: string };

async function userIdOf(page: Page, email: string) {
  const res = await page.request.get("/api/members");
  const { members } = (await res.json()) as { members: { userId: string; email: string }[] };
  const member = members.find((m) => m.email === email);
  expect(member, `${email} is in the Company`).toBeTruthy();
  return member?.userId ?? "";
}

/** Puts a Company member on a Team, as a lead when asked. Run as an owner or admin. */
export async function addTeamMember(
  page: Page,
  teamId: string,
  email: string,
  role: "lead" | "member" = "member",
) {
  const userId = await userIdOf(page, email);
  await post<{ member: TeamMemberRow }>(page, `/api/teams/${teamId}/members`, { userId });
  if (role === "lead") {
    const res = await page.request.patch(`/api/teams/${teamId}/members/${userId}`, {
      data: { role },
    });
    expect(res.status()).toBe(200);
  }
}

/** The Users on a Team, as the server lists them. */
export async function teamMembers(page: Page, teamId: string) {
  const res = await page.request.get(`/api/teams/${teamId}`);
  return ((await res.json()) as { members: TeamMemberRow[] }).members;
}

/** Creates a Project in the active Company. */
export async function createProject(
  page: Page,
  input: { name: string; key: string; teamId?: string },
) {
  return (await post<{ project: { id: string; key: string } }>(page, "/api/projects", input))
    .project;
}

/** Creates a Ticket. It lands at the bottom of Backlog. */
export async function createTicket(
  page: Page,
  input: { projectKey: string; title: string; type?: string } & Record<string, unknown>,
) {
  const body = { type: "task", ...input };
  return (await post<{ ticket: TicketRow }>(page, "/api/tickets", body)).ticket;
}

/** Moves a Ticket to a Status and, optionally, a zero-based position in it. */
export async function moveTicket(page: Page, key: string, status: string, position?: number) {
  const body = { status, position };
  return (await post<{ ticket: TicketRow }>(page, `/api/tickets/${key}/move`, body, 200)).ticket;
}

export async function createAgent(page: Page, name: string) {
  return (await post<{ agent: { id: string; name: string } }>(page, "/api/agents", { name })).agent;
}

export async function assignTicket(
  page: Page,
  key: string,
  assignee: { type: "user" | "agent"; id: string } | null,
) {
  const body = { assignee };
  return (await post<{ ticket: TicketRow }>(page, `/api/tickets/${key}/assign`, body, 200)).ticket;
}

/** Records that `key` blocks, is blocked by, or relates to `target`. */
export async function linkTickets(
  page: Page,
  key: string,
  kind: "blocks" | "blocked_by" | "relates_to",
  target: string,
) {
  await post(page, `/api/tickets/${key}/links`, { kind, target });
}

/** The Tickets of a Project in the server's own board order. */
export async function listTickets(page: Page, projectKey: string) {
  const res = await page.request.get(`/api/tickets?projectKey=${projectKey}&limit=200`);
  return ((await res.json()) as { tickets: TicketRow[] }).tickets;
}

/** An API Key for an Agent of the signed-in User. The key is shown only here. */
export async function createApiKey(page: Page, agentId: string) {
  const body = await post<{ secret: string }>(page, `/api/agents/${agentId}/keys`, {
    label: "e2e",
  });
  return body.secret;
}

/** A request context that acts as the Agent holding `apiKey`, never as a signed-in User. */
export function actAsAgent(apiKey: string): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: test.info().project.use.baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${apiKey}` },
  });
}

/** Adds a Comment as the signed-in User. */
export async function addComment(page: Page, key: string, body: string) {
  return post<{ comment: { id: string } }>(page, `/api/tickets/${key}/comments`, { body });
}

/**
 * An MCP client for the Agent holding `apiKey`, over real HTTP like Claude Code
 * would use it. Call `tool` to run a tool, and `close` when done.
 */
export async function connectMcp(apiKey: string) {
  const baseURL = test.info().project.use.baseURL;
  const client = new Client(
    { name: "clankerboard-e2e", version: "0.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", baseURL), {
      requestInit: { headers: { authorization: `Bearer ${apiKey}` } },
    }),
  );
  return {
    async tool(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
      return result;
    },
    close: () => client.close(),
  };
}
