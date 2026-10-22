import { expect, type Locator, type Page, test } from "@playwright/test";
import { resetDatabase } from "./database";
import {
  assignTicket,
  createAgent,
  createCompany,
  createProject,
  createTicket,
  listTickets,
  moveTicket,
  scrollsSideways,
  settledBox,
  signUp,
} from "./helpers";

test.beforeEach(resetDatabase);

// Runs at 1280px in light and at 375px in dark (see playwright.config.ts).

const statusLabels = ["Backlog", "To Do", "In Progress", "Review", "Done"];
const statusByLabel: Record<string, string> = {
  Backlog: "backlog",
  "To Do": "todo",
  "In Progress": "in_progress",
  Review: "review",
  Done: "done",
};

const onPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

async function openBoard(page: Page) {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await createProject(page, { name: "Platform", key: "PLAT" });
  await page.goto("/acme-robotics/projects/PLAT");
  await expect(page.getByRole("heading", { name: "Platform" })).toBeVisible();
}

const lane = (page: Page, label: string) => page.getByRole("region", { name: label });
const ticketIn = (page: Page, label: string, title: string) =>
  lane(page, label).getByRole("article", { name: title });

/** The titles in a Status, top to bottom. */
function titlesIn(page: Page, label: string) {
  return lane(page, label)
    .getByRole("article")
    .evaluateAll((els) => els.map((el) => el.querySelector("h3")?.textContent ?? ""));
}

test("shows the five Statuses in workflow order, with a count each", async ({ page }) => {
  await openBoard(page);
  await createTicket(page, { projectKey: "PLAT", title: "First" });
  await page.reload();

  await expect(lane(page, "Done")).toBeAttached();
  const names = await page
    .getByTestId("board-scroller")
    .getByRole("region")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  expect(names).toEqual(statusLabels);
  await expect(lane(page, "Backlog")).toContainText("1");
  await expect(lane(page, "Done").getByText("No tickets")).toBeVisible();
});

test("lists each Status's Tickets in the server's rank order", async ({ page }) => {
  await openBoard(page);
  const keys: string[] = [];
  for (let i = 1; i <= 10; i++) {
    keys.push((await createTicket(page, { projectKey: "PLAT", title: `Ticket ${i}` })).key);
  }
  // Moving each to the top of a Status builds ranks that differ between byte
  // order and a locale-aware sort ("Zz" sorts before "a0" only by bytes).
  for (const key of keys.slice(0, 7)) await moveTicket(page, key, "todo", 0);
  for (const key of keys.slice(7)) await moveTicket(page, key, "review");
  await moveTicket(page, keys[8] as string, "review", 0);
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(10);

  const expected = await listTickets(page, "PLAT");
  for (const label of statusLabels) {
    const status = statusByLabel[label];
    const titles = expected.filter((t) => t.status === status).map((t) => t.title);
    expect(await titlesIn(page, label)).toEqual(titles);
  }
  expect(await titlesIn(page, "To Do")).toEqual([
    "Ticket 7",
    "Ticket 6",
    "Ticket 5",
    "Ticket 4",
    "Ticket 3",
    "Ticket 2",
    "Ticket 1",
  ]);
});

test("leaves archived Tickets off the board", async ({ page }) => {
  await openBoard(page);
  const keep = await createTicket(page, { projectKey: "PLAT", title: "Keep" });
  const gone = await createTicket(page, { projectKey: "PLAT", title: "Gone" });
  const res = await page.request.post(`/api/tickets/${gone.key}/archive`);
  expect(res.status()).toBe(200);
  await page.reload();

  await expect(ticketIn(page, "Backlog", "Keep")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  expect(keep.key).toBe("PLAT-1");
});

test.describe("Ticket summary", () => {
  test("puts the title first and shows only what matters", async ({ page }) => {
    await openBoard(page);
    const epic = await createTicket(page, {
      projectKey: "PLAT",
      title: "Checkout",
      type: "epic",
    });
    await createTicket(page, {
      projectKey: "PLAT",
      title: "Pay by card",
      type: "story",
      priority: "urgent",
      parentKey: epic.key,
    });
    await createTicket(page, { projectKey: "PLAT", title: "Plain one", priority: "medium" });
    await createTicket(page, { projectKey: "PLAT", title: "Calm one", priority: "low" });
    await createTicket(page, {
      projectKey: "PLAT",
      title: "Hot one",
      type: "bug",
      priority: "high",
    });
    await page.reload();

    const story = ticketIn(page, "Backlog", "Pay by card");
    const title = story.getByRole("heading", { name: "Pay by card" });
    const identifier = story.getByText("PLAT-2", { exact: true });
    await expect(identifier).toBeVisible();
    await expect(story.getByRole("img", { name: "Story" })).toBeVisible();

    // The title is the heaviest, largest text, above the identifier group.
    const sizeOf = (el: Locator) =>
      el.evaluate((node) => ({
        size: Number.parseFloat(getComputedStyle(node).fontSize),
        weight: Number(getComputedStyle(node).fontWeight),
        family: getComputedStyle(node).fontFamily,
      }));
    const titleStyle = await sizeOf(title);
    const keyStyle = await sizeOf(identifier);
    expect(titleStyle.size).toBeGreaterThanOrEqual(keyStyle.size);
    expect(titleStyle.weight).toBeGreaterThan(keyStyle.weight);
    expect(keyStyle.family).toMatch(/mono/i);
    const titleBox = await title.boundingBox();
    const keyBox = await identifier.boundingBox();
    expect(keyBox?.y).toBeLessThan(titleBox?.y ?? 0);

    // The Parent Epic is shown, and urgent priority is a badge.
    await expect(story.getByText("Checkout", { exact: true })).toBeVisible();
    await expect(story.getByText("PLAT-1", { exact: true })).toBeVisible();
    await expect(story.getByText("Urgent", { exact: true })).toBeVisible();

    // Priority shows for high and urgent only.
    await expect(
      ticketIn(page, "Backlog", "Hot one").getByText("High", { exact: true }),
    ).toBeVisible();
    for (const [name, word] of [
      ["Plain one", "Medium"],
      ["Calm one", "Low"],
    ] as const) {
      await expect(ticketIn(page, "Backlog", name)).toBeVisible();
      await expect(ticketIn(page, "Backlog", name).getByText(word)).toHaveCount(0);
    }
  });

  test("marks an Agent Assignee with the bot icon and a User without it", async ({ page }) => {
    await openBoard(page);
    const agent = await createAgent(page, "Claude-Code-Agent-With-A-Very-Long-Name");
    const me = (await (await page.request.get("/api/me")).json()) as { user: { id: string } };
    const byAgent = await createTicket(page, {
      projectKey: "PLAT",
      title: "Agent work",
    });
    const byUser = await createTicket(page, { projectKey: "PLAT", title: "Human work" });
    await createTicket(page, { projectKey: "PLAT", title: "Nobody yet" });
    await assignTicket(page, byAgent.key, { type: "agent", id: agent.id });
    await assignTicket(page, byUser.key, { type: "user", id: me.user.id });
    await page.reload();

    const agentTicket = ticketIn(page, "Backlog", "Agent work");
    await expect(agentTicket.getByRole("img", { name: "Agent" })).toBeVisible();
    await expect(agentTicket).toContainText("Claude-Code-Agent");
    const humanTicket = ticketIn(page, "Backlog", "Human work");
    await expect(humanTicket).toContainText("Ada");
    await expect(humanTicket.getByRole("img", { name: "Agent" })).toHaveCount(0);
    await expect(
      ticketIn(page, "Backlog", "Nobody yet").getByRole("img", { name: "Agent" }),
    ).toHaveCount(0);

    // The Assignee sits in the bottom right corner of the Ticket, inside it, even when long.
    const ticket = await agentTicket.boundingBox();
    const assignee = await agentTicket.getByTestId("assignee").boundingBox();
    expect(assignee).not.toBeNull();
    expect((assignee?.x ?? 0) + (assignee?.width ?? 0)).toBeLessThanOrEqual(
      (ticket?.x ?? 0) + (ticket?.width ?? 0),
    );
    expect(assignee?.y ?? 0).toBeGreaterThan((ticket?.y ?? 0) + (ticket?.height ?? 0) / 2);
  });

  test("keeps a long title inside the Ticket", async ({ page }) => {
    await openBoard(page);
    const long = `${"Reconcile the nightly settlement export ".repeat(4)}Supercalifragilisticexpialidocious${"x".repeat(60)}`;
    await createTicket(page, { projectKey: "PLAT", title: long.slice(0, 200) });
    await page.reload();

    const ticket = lane(page, "Backlog").getByRole("article");
    const box = await ticket.boundingBox();
    const laneBox = await lane(page, "Backlog").boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      (laneBox?.x ?? 0) + (laneBox?.width ?? 0),
    );
    // Statuses share the row evenly, whatever their Tickets say.
    if (!onPhone(page)) {
      const done = await lane(page, "Done").boundingBox();
      expect(Math.abs((done?.width ?? 0) - (laneBox?.width ?? 0))).toBeLessThan(2);
    }
    const title = await ticket.getByRole("heading").boundingBox();
    expect((title?.x ?? 0) + (title?.width ?? 0)).toBeLessThanOrEqual(
      (box?.x ?? 0) + (box?.width ?? 0) + 1,
    );
    expect(await scrollsSideways(page)).toBe(false);
  });

  test("stands out from its Status and the page in both themes", async ({ page }) => {
    await openBoard(page);
    await createTicket(page, { projectKey: "PLAT", title: "Visible" });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      const ticket = ticketIn(page, "Backlog", "Visible");
      await expect(ticket).toBeVisible();
      const background = (el: Locator) =>
        el.evaluate((node) => getComputedStyle(node).backgroundColor);
      const colors = {
        page: await background(page.locator("body")),
        lane: await background(lane(page, "Backlog")),
        ticket: await background(ticket),
      };
      expect(colors.ticket).not.toBe(colors.lane);
      expect(colors.lane).not.toBe(colors.page);
    }
  });
});

test.describe("create Ticket dialog", () => {
  test("takes type, title, description, priority, and Parent", async ({ page }) => {
    await openBoard(page);
    const epic = await createTicket(page, {
      projectKey: "PLAT",
      title: "Checkout",
      type: "epic",
    });
    await createTicket(page, { projectKey: "PLAT", title: "Payments", type: "story" });
    await page.reload();

    await page.getByRole("button", { name: "Create ticket" }).click();
    const dialog = page.getByRole("dialog", { name: "Create ticket" });
    await dialog.getByLabel("Type").selectOption({ label: "Bug" });
    await dialog.getByLabel("Title").fill("Fix rounding");
    await dialog.getByLabel("Description").fill("Totals round **down**.");
    await dialog.getByLabel("Priority").selectOption({ label: "Urgent" });
    await dialog.getByLabel("Parent").selectOption({ label: "PLAT-1 Checkout" });
    await dialog.getByRole("button", { name: "Create ticket" }).click();

    await expect(dialog).toBeHidden();
    const ticket = ticketIn(page, "Backlog", "Fix rounding");
    await expect(ticket).toBeVisible();
    await expect(ticket.getByText("Urgent", { exact: true })).toBeVisible();
    await expect(ticket.getByText("Checkout", { exact: true })).toBeVisible();
    // It lands at the bottom of Backlog.
    expect(await titlesIn(page, "Backlog")).toEqual(["Checkout", "Payments", "Fix rounding"]);

    const created = (await listTickets(page, "PLAT")).find((t) => t.title === "Fix rounding");
    expect(created).toMatchObject({
      key: "PLAT-3",
      status: "backlog",
      type: "bug",
      priority: "urgent",
      description: "Totals round **down**.",
      parent: { key: epic.key },
    });
  });

  test("offers only Parents the type allows", async ({ page }) => {
    await openBoard(page);
    await createTicket(page, { projectKey: "PLAT", title: "Checkout", type: "epic" });
    await createTicket(page, { projectKey: "PLAT", title: "Payments", type: "story" });
    await createTicket(page, { projectKey: "PLAT", title: "A task", type: "task" });
    await page.reload();
    await page.getByRole("button", { name: "Create ticket" }).click();
    const dialog = page.getByRole("dialog", { name: "Create ticket" });
    const parents = dialog.getByLabel("Parent");
    const options = () => parents.locator("option").allTextContents();

    await dialog.getByLabel("Type").selectOption({ label: "Task" });
    expect(await options()).toEqual(["No parent", "PLAT-1 Checkout", "PLAT-2 Payments"]);
    await dialog.getByLabel("Type").selectOption({ label: "Bug" });
    expect(await options()).toEqual(["No parent", "PLAT-1 Checkout"]);
    await dialog.getByLabel("Type").selectOption({ label: "Epic" });
    await expect(parents).toBeDisabled();
  });

  test("asks for a title, and shows the server's refusal", async ({ page }) => {
    await openBoard(page);
    await page.getByRole("button", { name: "Create ticket" }).click();
    const dialog = page.getByRole("dialog", { name: "Create ticket" });

    await dialog.getByRole("button", { name: "Create ticket" }).click();

    await expect(dialog.getByRole("alert")).toHaveText("Enter a title.");
    await expect(page.getByRole("article")).toHaveCount(0);
    await dialog.getByLabel("Title").fill("x".repeat(201));
    await dialog.getByRole("button", { name: "Create ticket" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Titles can be up to 200 characters.");
  });

  test("closes without creating anything on cancel", async ({ page }) => {
    await openBoard(page);
    await page.getByRole("button", { name: "Create ticket" }).click();
    await page.getByRole("dialog").getByLabel("Title").fill("Never saved");
    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog")).toBeHidden();
    expect(await listTickets(page, "PLAT")).toEqual([]);
  });
});

test.describe("Agent prompt dialog", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("sits above Create ticket", async ({ page }) => {
    await openBoard(page);
    const prompt = await page.getByRole("button", { name: "Agent prompt" }).boundingBox();
    const create = await page.getByRole("button", { name: "Create ticket" }).boundingBox();
    expect(prompt).not.toBeNull();
    expect((prompt?.y ?? 0) + (prompt?.height ?? 0)).toBeLessThanOrEqual(create?.y ?? 0);
  });

  test("copies a prompt for this Project that connects to this server without an API Key", async ({
    page,
    baseURL,
  }) => {
    await openBoard(page);
    await page.getByRole("button", { name: "Agent prompt" }).click();
    const dialog = page.getByRole("dialog", { name: "Agent prompt" });
    const prompt = dialog.locator("pre");

    await expect(prompt).toContainText(
      'You will work on Tickets in the Agent Kanban Project "Platform" (Project Key PLAT)',
    );
    await expect(prompt).toContainText(`${baseURL}/acme-robotics/projects/PLAT`);
    await expect(prompt).toContainText(`${baseURL}/acme-robotics/agents`);
    await expect(prompt).toContainText(
      `claude mcp add --scope user --transport http agentkanban ${baseURL}/mcp --header "Authorization: Bearer <API key>"`,
    );
    await expect(prompt).toContainText("The resource agentkanban://projects/PLAT/board");
    await expect(prompt).toContainText(
      "list_tickets with projectKey PLAT, status todo, and assignee unassigned",
    );

    await dialog.getByRole("button", { name: "Copy prompt" }).click();
    await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      await prompt.textContent(),
    );
  });
});

test("fits the viewport: Statuses scroll sideways on a phone, and all show on a desktop", async ({
  page,
}) => {
  await openBoard(page);
  for (let i = 1; i <= 6; i++) {
    await createTicket(page, { projectKey: "PLAT", title: `Ticket ${i}` });
  }
  await moveTicket(page, "PLAT-6", "done");
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(6);
  const width = page.viewportSize()?.width ?? 0;

  // The page itself never scrolls sideways; the board does, inside its own scroller.
  expect(await scrollsSideways(page)).toBe(false);

  if (onPhone(page)) {
    const scroller = page.getByTestId("board-scroller");
    expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    const first = await lane(page, "Backlog").boundingBox();
    expect(first?.x).toBeGreaterThanOrEqual(0);
    const ticket = await ticketIn(page, "Backlog", "Ticket 1").boundingBox();
    expect(ticket?.width).toBeGreaterThanOrEqual(width * 0.8);
    expect(ticket?.x).toBeGreaterThanOrEqual(0);

    await lane(page, "Done").scrollIntoViewIfNeeded();
    await expect(lane(page, "Done")).toBeInViewport({ ratio: 0.9 });
    await expect(ticketIn(page, "Done", "Ticket 6")).toBeInViewport();
    expect(await scrollsSideways(page)).toBe(false);

    const create = await page.getByRole("button", { name: "Create ticket" }).boundingBox();
    expect(create?.height).toBeGreaterThanOrEqual(44);
  } else {
    for (const label of statusLabels) await expect(lane(page, label)).toBeInViewport({ ratio: 1 });
  }
});

test("the dialog's close control is touch sized on a phone", async ({ page }) => {
  await openBoard(page);
  await page.getByRole("button", { name: "Create ticket" }).click();

  const box = await settledBox(page.getByRole("dialog").getByRole("button", { name: "Close" }));

  if (onPhone(page)) {
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

test("links back to the Projects list", async ({ page }) => {
  await openBoard(page);

  await page.getByRole("link", { name: "Projects" }).click();

  await expect(page).toHaveURL("/acme-robotics");
});
