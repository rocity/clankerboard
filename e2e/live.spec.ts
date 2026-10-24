import { expect, type Page, test } from "@playwright/test";
import { lane, mouseDrag } from "./board-drag";
import { resetDatabase } from "./database";
import {
  companies,
  connectMcp,
  createAgent,
  createApiKey,
  createCompany,
  createProject,
  createTicket,
  joinCompany,
  linkTickets,
  signUp,
} from "./helpers";

test.beforeEach(resetDatabase);

// The live board (06-08): an Agent works over MCP and an open page follows. Every
// test runs at 1280px in light and at 375px in dark (see playwright.config.ts).

const screenshots = process.env.LIVE_SCREENSHOTS;

const ticketIn = (page: Page, label: string, title: string) =>
  lane(page, label).getByRole("article", { name: title });

type Probe = { __sources: string[]; __closed: number; __events: string[]; __marker?: boolean };

/**
 * Records what the page does with the stream: each EventSource it makes, each
 * one it closes, and the name of every event it receives. Call before `goto`.
 */
async function watchStream(page: Page) {
  await page.addInitScript(() => {
    const probe = window as unknown as Probe;
    probe.__sources = [];
    probe.__closed = 0;
    probe.__events = [];
    const Native = window.EventSource;
    window.EventSource = class extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        probe.__sources.push(String(url));
      }
      close() {
        probe.__closed += 1;
        super.close();
      }
      addEventListener(type: string, listener: unknown, options?: unknown) {
        const add = super.addEventListener as (...args: unknown[]) => void;
        if (type === "error") {
          add.call(this, type, () => probe.__events.push(`error:${this.readyState}`));
        } else if (type !== "open") {
          add.call(this, type, () => probe.__events.push(type));
        }
        add.call(this, type, listener, options);
      }
    } as typeof EventSource;
  });
}

const sources = (page: Page) => page.evaluate(() => (window as unknown as Probe).__sources.length);
const closed = (page: Page) => page.evaluate(() => (window as unknown as Probe).__closed);
const received = (page: Page) => page.evaluate(() => (window as unknown as Probe).__events);

/** The URLs of the board reads the page makes from now on. Events must not cause any. */
function boardReads(page: Page) {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET" && /\/api\/tickets\?/.test(request.url())) {
      urls.push(request.url());
    }
  });
  return urls;
}

/** Ada owns Acme Robotics with a Project PLAT and the given Tickets. */
async function seedAcme(page: Page, titles: string[]) {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await createProject(page, { name: "Platform", key: "PLAT" });
  for (const title of titles) await createTicket(page, { projectKey: "PLAT", title });
}

/** An Agent of the signed-in User with a key, connected over MCP like Claude Code would. */
async function agentOverMcp(page: Page, name: string) {
  const agent = await createAgent(page, name);
  const mcp = await connectMcp(await createApiKey(page, agent.id));
  return { ...agent, ...mcp };
}

async function openBoard(page: Page, titles: string[], path = "/acme-robotics/projects/PLAT") {
  await page.goto(path);
  // With a Ticket open, the panel is modal and the heading behind it is hidden.
  if (path.includes("/tickets/")) return expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Platform" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(titles.length);
}

/**
 * Ends this page's stream on the server the way another tab's Company switch
 * does, then puts the session back. The browser reconnects by itself after three
 * seconds with its last event id.
 */
async function dropConnection(page: Page, otherCompanyId: string) {
  const { activeCompanyId } = await companies(page);
  for (const companyId of [otherCompanyId, activeCompanyId]) {
    const res = await page.request.put("/api/active-company", { data: { companyId } });
    expect(res.status()).toBe(200);
  }
}

/** A second Company for dropping connections, then Acme active again, and an Agent in Acme. */
async function addGlobex(page: Page) {
  const globex = await createCompany(page, "Globex");
  const { companies: all } = await companies(page);
  const acme = all.find((c) => c.slug === "acme-robotics");
  await page.request.put("/api/active-company", { data: { companyId: acme?.id } });
  return { globexId: globex.id, agent: await agentOverMcp(page, "Claude-1") };
}

async function shot(page: Page, name: string) {
  if (screenshots) {
    await page.screenshot({ path: `${screenshots}/${name}-${test.info().project.name}.png` });
  }
}

/**
 * Flow 3: create an Agent and a key in the UI, claim a Ticket from a test-side
 * MCP client using that key, and watch the open board move the Ticket to In
 * Progress with the Agent badge, without a reload.
 */
async function flow3(page: Page, name: string) {
  await watchStream(page);
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await createProject(page, { name: "Platform", key: "PLAT" });
  await createTicket(page, { projectKey: "PLAT", title: "Ship the board" });
  await createTicket(page, { projectKey: "PLAT", title: "Write the docs" });

  await page.goto("/acme-robotics/agents");
  await page.getByRole("button", { name: "New agent" }).click();
  await page.getByLabel("Name").fill("Claude-1");
  await page.getByRole("button", { name: "Create agent" }).click();
  await page
    .getByRole("article", { name: "Claude-1" })
    .getByRole("button", { name: "Create key" })
    .click();
  await page.getByLabel("Label").fill("laptop");
  await page.getByRole("button", { name: "Create key" }).click();
  const apiKey = await page.getByRole("dialog").getByLabel("API key").inputValue();
  expect(apiKey).toMatch(/^cb_/);

  await openBoard(page, ["Ship the board", "Write the docs"]);
  await page.evaluate(() => {
    (window as unknown as Probe).__marker = true;
  });
  expect(await sources(page)).toBe(1);
  const reads = boardReads(page);
  // A phone shows one Status at a time. Watch the one the Ticket is about to enter.
  await lane(page, "In Progress").scrollIntoViewIfNeeded();
  await shot(page, `${name}-before`);

  const mcp = await connectMcp(apiKey);
  await mcp.tool("claim_ticket", { key: "PLAT-1" });

  const ticket = ticketIn(page, "In Progress", "Ship the board");
  await expect(ticket).toBeVisible();
  await expect(ticket.getByTestId("assignee")).toContainText("Claude-1");
  await expect(ticket.getByRole("img", { name: "Agent" })).toBeVisible();
  await expect(ticketIn(page, "Backlog", "Ship the board")).toHaveCount(0);
  await expect(ticketIn(page, "Backlog", "Write the docs")).toBeVisible();
  // The change is marked for a moment because someone else made it.
  await expect(page.locator('[data-ticket-key="PLAT-1"]').getByTestId("live-change")).toBeVisible();
  await shot(page, `${name}-claimed`);
  await expect(page.getByTestId("live-change")).toHaveCount(0, { timeout: 5000 });

  // No reload, no refetch, and still the one stream.
  expect(await page.evaluate(() => (window as unknown as Probe).__marker)).toBe(true);
  expect(reads).toEqual([]);
  expect(await sources(page)).toBe(1);
  expect(await received(page)).toEqual(expect.arrayContaining(["ticket.claimed"]));
  await mcp.close();
}

test("flow 3: an Agent claims a Ticket over MCP and the open board shows it move", async ({
  page,
}) => {
  await flow3(page, "flow3");
});

test.describe("flow 3 in dark mode on a wide screen", () => {
  test.use({ colorScheme: "dark", viewport: { width: 1280, height: 800 } });

  test("the claim shows live, with the mark readable in dark", async ({ page }) => {
    // The phone project already runs flow 3 in dark; this one adds it at 1280px.
    test.skip(test.info().project.name !== "desktop-light");
    await flow3(page, "flow3-dark");
  });
});

test("an Agent Comment over MCP appears live in an open Ticket", async ({ page }) => {
  await seedAcme(page, ["Ship the board"]);
  const agent = await agentOverMcp(page, "Claude-1");
  await openBoard(page, ["Ship the board"], "/acme-robotics/projects/PLAT/tickets/PLAT-1");
  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(panel.getByText("Tests pass.")).toHaveCount(0);

  await agent.tool("add_comment", { key: "PLAT-1", body: "Tests pass. Moving to **review**." });
  const comment = panel.locator('[data-kind="comment"]');
  await expect(comment).toContainText("Tests pass. Moving to review.");
  await expect(comment).toContainText("Claude-1");
  await expect(comment.getByRole("img", { name: "Agent" })).toBeVisible();
  await shot(page, "comment-live");

  // Other Activity shows live too: the Status field and a Timeline line follow the Agent.
  await agent.tool("claim_ticket", { key: "PLAT-1" });
  await expect(panel.getByLabel("Status")).toHaveValue("in_progress");
  await expect(panel.getByLabel("Assignee")).toHaveValue(/agent:/);
  await expect(panel.locator('[data-kind="activity"]').first()).toContainText(
    "claimed this ticket",
  );
  await agent.close();
});

test("a Ticket someone else deletes closes its open panel with a note", async ({
  page,
  browser,
}) => {
  await seedAcme(page, ["Ship the board", "Write the docs"]);
  await openBoard(
    page,
    ["Ship the board", "Write the docs"],
    "/acme-robotics/projects/PLAT/tickets/PLAT-1",
  );
  await expect(page.getByRole("dialog")).toBeVisible();

  const grace = await joinCompany(page, browser, {
    name: "Grace",
    email: "grace@example.com",
    role: "admin",
  });
  const res = await grace.request.delete("/api/tickets/PLAT-1");
  expect(res.status()).toBe(204);

  await expect(page.getByText("PLAT-1 no longer exists.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL("/acme-robotics/projects/PLAT");
  await expect(page.getByRole("article")).toHaveCount(1);
  await grace.context().close();
});

test("the user's own move shows no flicker and no highlight when the stream echoes it", async ({
  page,
}) => {
  await watchStream(page);
  await seedAcme(page, ["Ship the board", "Write the docs"]);
  await openBoard(page, ["Ship the board", "Write the docs"]);
  const reads = boardReads(page);

  // Hold the move's answer back, so the stream's echo of it arrives first.
  await page.route("**/api/tickets/*/move", async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.fulfill({ response });
  });
  // Every frame, note where the Ticket is, and whether anything is marked as changed.
  await page.evaluate(() => {
    const seen: string[] = [];
    let marked = false;
    Object.assign(window, { __seen: seen, __marked: () => marked });
    const sample = () => {
      const li = document.querySelector('[data-ticket-key="PLAT-1"]');
      const where = li?.closest("section")?.getAttribute("data-status") ?? "nowhere";
      if (seen.at(-1) !== where) seen.push(where);
      if (document.querySelector('[data-testid="live-change"]')) marked = true;
      requestAnimationFrame(sample);
    };
    sample();
  });

  const answered = page.waitForResponse((r) => r.url().includes("/move"));
  await mouseDrag(page, ticketIn(page, "Backlog", "Ship the board"), { status: "In Progress" });
  await answered;
  await expect(ticketIn(page, "In Progress", "Ship the board")).toBeVisible();
  // The echo was received, and the Ticket never left its new place or returned to the old one.
  await expect.poll(() => received(page)).toContain("ticket.moved");
  await page.waitForTimeout(500);
  const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  expect(seen).toEqual(["backlog", "in_progress"]);
  expect(
    await page.evaluate(() => (window as unknown as { __marked: () => boolean }).__marked()),
  ).toBe(false);
  expect(reads).toEqual([]);
});

test("a filtered board takes only the Tickets that match, and a search board refetches", async ({
  page,
}) => {
  await seedAcme(page, ["Ship the board", "Write the docs"]);
  const agent = await agentOverMcp(page, "Claude-1");

  // Only Tickets held by an Agent.
  await page.goto("/acme-robotics/projects/PLAT?assignee=agents");
  await expect(page.getByText("No tickets match these filters.")).toBeVisible();
  const reads = boardReads(page);
  await agent.tool("claim_ticket", { key: "PLAT-2" });
  await expect(ticketIn(page, "In Progress", "Write the docs")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  expect(reads).toEqual([]);

  // Only Tickets nobody holds: the claimed one leaves.
  await page.goto("/acme-robotics/projects/PLAT?assignee=unassigned");
  await expect(ticketIn(page, "Backlog", "Ship the board")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await agent.tool("claim_ticket", { key: "PLAT-1" });
  await expect(page.getByRole("article")).toHaveCount(0);

  // A text search is judged by the server, so a new match is found by a refetch.
  await page.goto("/acme-robotics/projects/PLAT?q=polish");
  await expect(page.getByText("No tickets match these filters.")).toBeVisible();
  await agent.tool("create_ticket", { projectKey: "PLAT", type: "task", title: "Board polish" });
  await expect(ticketIn(page, "Backlog", "Board polish")).toBeVisible();
  await agent.close();
});

test("a new Project shows on the Projects list without a reload", async ({ page }) => {
  await seedAcme(page, []);
  await page.goto("/acme-robotics");
  await expect(page.getByRole("link", { name: /Platform/ })).toBeVisible();
  await createProject(page, { name: "Billing", key: "BILL" });
  await expect(page.getByRole("link", { name: /Billing/ })).toBeVisible();
});

test("a dropped connection catches up on what it missed, without refetching the board", async ({
  page,
}) => {
  await watchStream(page);
  await seedAcme(page, ["Ship the board", "Write the docs"]);
  const { globexId, agent } = await addGlobex(page);

  await openBoard(page, ["Ship the board", "Write the docs"]);
  const reads = boardReads(page);

  // The browser only sends a last event id once it has received one.
  await agent.tool("claim_ticket", { key: "PLAT-1" });
  await expect(ticketIn(page, "In Progress", "Ship the board")).toBeVisible();

  await dropConnection(page, globexId);
  await agent.tool("claim_ticket", { key: "PLAT-2" });
  // The browser reconnects after three seconds and the server replays the claim.
  await expect(ticketIn(page, "In Progress", "Write the docs")).toBeVisible({ timeout: 15_000 });
  expect(reads).toEqual([]);
  expect(await sources(page)).toBe(1);
  expect(await received(page)).not.toContain("resync");
  await agent.close();
});

test("a resync refetches the board", async ({ page }) => {
  await watchStream(page);
  await seedAcme(page, ["Ship the board", "Write the docs"]);
  const { globexId, agent } = await addGlobex(page);

  await openBoard(page, ["Ship the board", "Write the docs"]);
  const reads = boardReads(page);

  // A last event id the server cannot place means it cannot replay: it answers with a resync.
  await page.route("**/api/stream", (route) =>
    route.continue({ headers: { ...route.request().headers(), "last-event-id": "unknown" } }),
  );
  await dropConnection(page, globexId);
  await agent.tool("claim_ticket", { key: "PLAT-1" });

  await expect(ticketIn(page, "In Progress", "Ship the board")).toBeVisible({ timeout: 15_000 });
  expect(await received(page)).toContain("resync");
  expect(reads.length).toBeGreaterThan(0);
  await agent.close();
});

test("a lost connection shows a quiet notice and recovers by itself", async ({ page }) => {
  await seedAcme(page, ["Ship the board", "Write the docs"]);
  const { globexId, agent } = await addGlobex(page);

  await openBoard(page, ["Ship the board", "Write the docs"]);
  await expect(page.getByTestId("stream-notice")).toHaveCount(0);

  await page.route("**/api/stream", (route) => route.abort());
  await dropConnection(page, globexId);
  // Nothing shows for a blink, then a small notice does.
  const notice = page.getByTestId("stream-notice");
  await expect(notice).toHaveText("Connection lost. Retrying.", { timeout: 10_000 });
  await shot(page, "notice");

  await agent.tool("claim_ticket", { key: "PLAT-1" });
  await page.unroute("**/api/stream");
  await expect(ticketIn(page, "In Progress", "Ship the board")).toBeVisible({ timeout: 20_000 });
  await expect(notice).toHaveCount(0);
  await agent.close();
});

test("a connection the server refuses is made again and the board is read again", async ({
  page,
}) => {
  await watchStream(page);
  await seedAcme(page, ["Ship the board", "Write the docs"]);
  const { globexId, agent } = await addGlobex(page);

  await openBoard(page, ["Ship the board", "Write the docs"]);
  const reads = boardReads(page);

  // A refused connection leaves a browser EventSource dead for good.
  // (A 5xx is retried by the browser itself; a 4xx like this one is not.)
  let refused = 0;
  await page.route("**/api/stream", (route) => {
    refused += 1;
    return route.fulfill({ status: 400, json: { error: "Pick a company first." } });
  });
  await dropConnection(page, globexId);
  await expect(page.getByTestId("stream-notice")).toBeVisible({ timeout: 10_000 });
  await agent.tool("claim_ticket", { key: "PLAT-1" });
  // The browser's own retry is refused, and so is the first one the app makes itself.
  await expect.poll(() => refused, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await page.unroute("**/api/stream");

  await expect(ticketIn(page, "In Progress", "Ship the board")).toBeVisible({ timeout: 30_000 });
  expect(await received(page)).toContain("error:2");
  expect(await sources(page)).toBeGreaterThan(1);
  expect(reads.length).toBeGreaterThan(0);
  await expect(page.getByTestId("stream-notice")).toHaveCount(0);
  await agent.close();
});

test("switching Company switches the stream", async ({ page }) => {
  await watchStream(page);
  await signUp(page, "Ada", "ada@example.com");
  // Each Company has its own Project, Ticket, and Agent. Creating one makes it active.
  await createCompany(page, "Acme Robotics");
  await createProject(page, { name: "Platform", key: "PLAT" });
  await createTicket(page, { projectKey: "PLAT", title: "Acme task" });
  const acmeAgent = await agentOverMcp(page, "Acme-Agent");
  await createCompany(page, "Globex");
  await createProject(page, { name: "Platform", key: "PLAT" });
  await createTicket(page, { projectKey: "PLAT", title: "Globex task" });
  const globexAgent = await agentOverMcp(page, "Globex-Agent");

  await page.goto("/acme-robotics/projects/PLAT");
  await expect(ticketIn(page, "Backlog", "Acme task")).toBeVisible();
  expect(await sources(page)).toBe(1);

  await page.getByRole("button", { name: "Company" }).click();
  await page.getByRole("menuitem", { name: "Globex" }).click();
  await page.getByRole("link", { name: /Platform/ }).click();
  await expect(ticketIn(page, "Backlog", "Globex task")).toBeVisible();
  // The first stream was closed and one for Globex opened.
  expect(await sources(page)).toBe(2);
  expect(await closed(page)).toBe(1);

  await globexAgent.tool("claim_ticket", { key: "PLAT-1" });
  await expect(ticketIn(page, "In Progress", "Globex task")).toBeVisible();

  // And back: Acme's board is live again, and Globex's stream is gone.
  await page.getByRole("button", { name: "Company" }).click();
  await page.getByRole("menuitem", { name: "Acme Robotics" }).click();
  await page.getByRole("link", { name: /Platform/ }).click();
  await expect(ticketIn(page, "Backlog", "Acme task")).toBeVisible();
  expect(await sources(page)).toBe(3);
  await acmeAgent.tool("claim_ticket", { key: "PLAT-1" });
  await expect(ticketIn(page, "In Progress", "Acme task")).toBeVisible();
  await acmeAgent.close();
  await globexAgent.close();
});

test("moving around inside a Company does not re-read the Company list or reopen the stream", async ({
  page,
}) => {
  await watchStream(page);
  await seedAcme(page, ["Ship the board"]);
  await openBoard(page, ["Ship the board"]);
  expect(await sources(page)).toBe(1);

  const companyReads: string[] = [];
  const switches: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/companies") companyReads.push(path);
    if (request.method() === "PUT" && path === "/api/active-company") switches.push(path);
  });

  for (const name of ["Members", "Teams"]) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  }
  await page.goBack();
  await page.goBack();
  await expect(ticketIn(page, "Backlog", "Ship the board")).toBeVisible();

  expect(companyReads).toEqual([]);
  expect(switches).toEqual([]);
  expect(await sources(page)).toBe(1);
  expect(await closed(page)).toBe(0);
});

test("switching Company never reads the old Project key against the new Company", async ({
  page,
}) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await createProject(page, { name: "Platform", key: "PLAT" });
  await createTicket(page, { projectKey: "PLAT", title: "Acme task" });
  await createCompany(page, "Globex");
  await createProject(page, { name: "Platform", key: "PLAT" });
  await createTicket(page, { projectKey: "PLAT", title: "Globex task" });

  await page.goto("/acme-robotics/projects/PLAT");
  await expect(ticketIn(page, "Backlog", "Acme task")).toBeVisible();

  // From the click until the Globex board is asked for, nothing may read a board.
  const reads = boardReads(page);
  await page.getByRole("button", { name: "Company" }).click();
  await page.getByRole("menuitem", { name: "Globex" }).click();
  await expect(page.getByRole("heading", { name: "Globex" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(reads).toEqual([]);

  await page.getByRole("link", { name: /Platform/ }).click();
  await expect(ticketIn(page, "Backlog", "Globex task")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
});

test("a tab whose session moved to another Company stops following and offers a reload", async ({
  page,
  context,
}) => {
  await watchStream(page);
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await createProject(page, { name: "Platform", key: "PLAT" });
  await createTicket(page, { projectKey: "PLAT", title: "Ship the board" });
  const agent = await agentOverMcp(page, "Claude-1");
  await createCompany(page, "Globex");

  await openBoard(page, ["Ship the board"]);

  // Another tab opens Globex. The cookie is shared, so the session's Company is now Globex.
  const other = await context.newPage();
  await other.goto("/globex");
  await expect(other.getByRole("heading", { name: "Globex" })).toBeVisible();

  // The first tab's stream is ended and the browser reconnects onto Globex. The tab notices.
  const notice = page.getByTestId("stream-notice");
  await expect(notice).toContainText("Live updates stopped", { timeout: 15_000 });
  await shot(page, "elsewhere");
  await other.close();

  await notice.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByRole("heading", { name: "Platform" })).toBeVisible();
  await expect(ticketIn(page, "Backlog", "Ship the board")).toBeVisible();
  await agent.tool("claim_ticket", { key: "PLAT-1" });
  await expect(ticketIn(page, "In Progress", "Ship the board")).toBeVisible();
  await expect(notice).toHaveCount(0);
  await agent.close();
});

test("an unauthorized event ends the stream and goes to sign-in with a way back", async ({
  page,
}) => {
  await seedAcme(page, ["Ship the board"]);
  const { globexId, agent } = await addGlobex(page);
  await openBoard(page, ["Ship the board"]);

  // The server says the session is over, as it does when the cookie expired mid-stream.
  await page.route("**/api/stream", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'retry: 60000\n\nevent: unauthorized\ndata: {"error":"Your session expired. Sign in again."}\n\n',
    }),
  );
  await dropConnection(page, globexId);

  await expect(page).toHaveURL(/\/sign-in\?redirect=%2Facme-robotics%2Fprojects%2FPLAT/, {
    timeout: 15_000,
  });
  await agent.close();
});

test("with reduced motion the mark stays still instead of fading", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedAcme(page, ["Ship the board"]);
  const agent = await agentOverMcp(page, "Claude-1");
  await openBoard(page, ["Ship the board"]);

  await agent.tool("claim_ticket", { key: "PLAT-1" });
  const mark = page.getByTestId("live-change");
  await expect(mark).toBeVisible();
  expect(await mark.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await expect(mark).toHaveCount(0, { timeout: 5000 });
  await agent.close();
});

test("a Blocked card gains and loses its marker live when another session moves the blocker", async ({
  page,
}) => {
  await watchStream(page);
  await seedAcme(page, ["Design the schema", "Build the API", "Write the docs"]);
  await linkTickets(page, "PLAT-1", "blocks", "PLAT-2");
  const agent = await agentOverMcp(page, "Claude-1");
  await openBoard(page, ["Design the schema", "Build the API", "Write the docs"]);
  const reads = boardReads(page);

  const marker = ticketIn(page, "Backlog", "Build the API").getByRole("img", {
    name: "Blocked by 1 ticket",
  });
  await expect(marker).toBeVisible();
  await expect(page.getByRole("img", { name: /^Blocked by/ })).toHaveCount(1);
  await shot(page, "blocked-before");

  // The blocker is finished elsewhere, so the Ticket is free to start.
  await agent.tool("move_ticket", { key: "PLAT-1", status: "done" });
  await expect(marker).toHaveCount(0);
  await expect(page.getByRole("img", { name: /^Blocked by/ })).toHaveCount(0);
  await expect(page.locator('[data-ticket-key="PLAT-2"]').getByTestId("live-change")).toBeVisible();
  await shot(page, "blocked-cleared");

  // Reopened, it blocks again.
  await agent.tool("move_ticket", { key: "PLAT-1", status: "in_progress" });
  await expect(marker).toBeVisible();

  expect(reads).toEqual([]);
  expect(await received(page)).toEqual(
    expect.arrayContaining(["ticket.unblocked", "ticket.blocked"]),
  );
  await agent.close();
});
