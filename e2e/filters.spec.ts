import { expect, type Page, test } from "@playwright/test";
import { resetDatabase } from "./database";
import {
  assignTicket,
  createAgent,
  createCompany,
  createProject,
  createTeam,
  createTicket,
  scrollsSideways,
  signUp,
} from "./helpers";

test.beforeEach(resetDatabase);

// Runs at 1280px in light and at 375px in dark (see playwright.config.ts).

const onPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

/** The titles on the board, in board order. */
const titles = (page: Page) =>
  page
    .getByRole("article")
    .evaluateAll((els) => els.map((el) => el.querySelector("h3")?.textContent));

/** Waits until the board shows exactly these titles, in any order. */
async function expectTitles(page: Page, expected: string[]) {
  await expect
    .poll(async () => ((await titles(page)) as string[]).sort())
    .toEqual([...expected].sort());
}

/** On a phone the filters sit behind a "Filters" button. */
async function openFilters(page: Page) {
  if (!onPhone(page)) return;
  const toggle = page.getByRole("button", { name: /^Filters/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

/** A filter's dropdown. (Not by label: a Ticket Type icon is also labelled "Epic".) */
const select = (page: Page, name: string) => page.getByRole("combobox", { name, exact: true });

/** The query string of the page URL as a plain object. */
const params = (page: Page) => Object.fromEntries(new URL(page.url()).searchParams);

type Seed = { agentId: string; userId: string };

async function openBoard(page: Page): Promise<Seed> {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await createProject(page, { name: "Platform", key: "PLAT" });
  const agent = await createAgent(page, "Claude");
  const me = (await (await page.request.get("/api/me")).json()) as { user: { id: string } };
  return { agentId: agent.id, userId: me.user.id };
}

async function showBoard(page: Page, search = "") {
  await page.goto(`/acme-robotics/projects/PLAT${search}`);
  await expect(page.getByRole("heading", { name: "Platform" })).toBeVisible();
}

test("filters by any Agent and searches by text, and the URL holds both", async ({
  page,
  browser,
}) => {
  const { agentId, userId } = await openBoard(page);
  const byAgent = await createTicket(page, { projectKey: "PLAT", title: "Fix login redirect" });
  const alsoByAgent = await createTicket(page, { projectKey: "PLAT", title: "Fix header spacing" });
  const byUser = await createTicket(page, { projectKey: "PLAT", title: "Write login docs" });
  await createTicket(page, { projectKey: "PLAT", title: "Fix login copy" });
  await assignTicket(page, byAgent.key, { type: "agent", id: agentId });
  await assignTicket(page, alsoByAgent.key, { type: "agent", id: agentId });
  await assignTicket(page, byUser.key, { type: "user", id: userId });
  await showBoard(page);
  await expect(page.getByRole("article")).toHaveCount(4);

  await openFilters(page);
  await select(page, "Assignee").selectOption({ label: "Any agent" });
  await expectTitles(page, ["Fix login redirect", "Fix header spacing"]);
  await page.getByRole("searchbox", { name: "Search" }).fill("login");
  await expectTitles(page, ["Fix login redirect"]);
  expect(params(page)).toEqual({ assignee: "agents", q: "login" });

  // A reload keeps the view.
  await page.reload();
  await expectTitles(page, ["Fix login redirect"]);
  await openFilters(page);
  await expect(select(page, "Assignee")).toHaveValue("agents");
  await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue("login");

  // So does a fresh browser context given the same link.
  const { viewport, colorScheme, hasTouch } = test.info().project.use;
  const context = await browser.newContext({
    viewport,
    colorScheme,
    hasTouch,
    storageState: await page.context().storageState(),
  });
  const shared = await context.newPage();
  await shared.goto(page.url());
  await expectTitles(shared, ["Fix login redirect"]);
  await context.close();
});

test.describe("each filter", () => {
  async function seed(page: Page) {
    const { agentId, userId } = await openBoard(page);
    const epic = await createTicket(page, { projectKey: "PLAT", title: "Checkout", type: "epic" });
    await createTicket(page, { projectKey: "PLAT", title: "Other epic", type: "epic" });
    const pay = await createTicket(page, {
      projectKey: "PLAT",
      title: "Pay by card",
      type: "story",
      priority: "urgent",
      parentKey: epic.key,
    });
    const bug = await createTicket(page, {
      projectKey: "PLAT",
      title: "Rounding bug",
      type: "bug",
      priority: "high",
      parentKey: epic.key,
    });
    const task = await createTicket(page, {
      projectKey: "PLAT",
      title: "Write docs",
      type: "task",
      priority: "low",
    });
    await assignTicket(page, pay.key, { type: "agent", id: agentId });
    await assignTicket(page, bug.key, { type: "user", id: userId });
    return { epic, pay, bug, task, agentId, userId };
  }

  const all = ["Checkout", "Other epic", "Pay by card", "Rounding bug", "Write docs"];

  test("narrow by Assignee: me, any User, a specific Actor, and unassigned", async ({ page }) => {
    const { userId, agentId } = await seed(page);
    await showBoard(page);
    await expectTitles(page, all);
    await openFilters(page);
    const assignee = select(page, "Assignee");

    await assignee.selectOption({ label: "Me" });
    await expectTitles(page, ["Rounding bug"]);
    expect(params(page)).toEqual({ assignee: "me" });

    await assignee.selectOption({ label: "Any user" });
    await expectTitles(page, ["Rounding bug"]);
    expect(params(page)).toEqual({ assignee: "users" });

    await assignee.selectOption({ label: "Claude" });
    await expectTitles(page, ["Pay by card"]);
    expect(params(page)).toEqual({ assignee: `agent:${agentId}` });

    await assignee.selectOption({ label: "Ada" });
    await expectTitles(page, ["Rounding bug"]);
    expect(params(page)).toEqual({ assignee: `user:${userId}` });

    await assignee.selectOption({ label: "Unassigned" });
    await expectTitles(page, ["Checkout", "Other epic", "Write docs"]);

    await assignee.selectOption({ label: "Anyone" });
    await expectTitles(page, all);
    expect(params(page)).toEqual({});
  });

  test("narrow by priority, type, and Epic, and combine them", async ({ page }) => {
    await seed(page);
    await showBoard(page);
    await openFilters(page);

    await select(page, "Priority").selectOption({ label: "Urgent" });
    await expectTitles(page, ["Pay by card"]);
    await select(page, "Priority").selectOption({ label: "Any priority" });

    await select(page, "Type").selectOption({ label: "Epic" });
    await expectTitles(page, ["Checkout", "Other epic"]);
    await select(page, "Type").selectOption({ label: "Any type" });

    await select(page, "Epic").selectOption({ label: "PLAT-1 Checkout" });
    await expectTitles(page, ["Pay by card", "Rounding bug"]);
    expect(params(page)).toEqual({ epic: "PLAT-1" });
    await select(page, "Type").selectOption({ label: "Bug" });
    await expectTitles(page, ["Rounding bug"]);
    expect(params(page)).toEqual({ epic: "PLAT-1", type: "bug" });
  });

  test("narrow by Team: only a Project of that Team shows Tickets", async ({ page }) => {
    await seed(page);
    const team = await createTeam(page, "Payments");
    const other = await createTeam(page, "Design");
    await page.request.patch("/api/projects/PLAT", { data: { teamId: team.id } });
    await showBoard(page);
    await openFilters(page);

    await select(page, "Team").selectOption({ label: "Payments" });
    await expectTitles(page, all);
    expect(params(page)).toEqual({ team: team.id });

    await select(page, "Team").selectOption({ label: "Design" });
    await expectTitles(page, []);
    await expect(page.getByText("No tickets match these filters.")).toBeVisible();
    expect(params(page)).toEqual({ team: other.id });
  });

  test("a link with filters opens the filtered board, and ignores bad values", async ({ page }) => {
    await seed(page);
    await showBoard(page, "?type=bug&priority=high");
    await expectTitles(page, ["Rounding bug"]);

    await showBoard(
      page,
      "?type=nonsense&priority=urgent&assignee=whoever&epic=nope&archived=maybe",
    );
    await expectTitles(page, ["Pay by card"]);
    await openFilters(page);
    await expect(select(page, "Type")).toHaveValue("");
    await expect(select(page, "Assignee")).toHaveValue("");
    await expect(select(page, "Epic")).toHaveValue("");
    await expect(page.getByLabel("Show archived")).not.toBeChecked();
    await expect(select(page, "Priority")).toHaveValue("urgent");
  });

  test("a numeric search is still text", async ({ page }) => {
    await seed(page);
    await createTicket(page, { projectKey: "PLAT", title: "Upgrade to 2024 tax tables" });
    await showBoard(page, "?q=2024");
    await expectTitles(page, ["Upgrade to 2024 tax tables"]);
    await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue("2024");
  });

  test("clears everything at once", async ({ page }) => {
    await seed(page);
    await showBoard(page, "?type=bug&q=rounding");
    await expectTitles(page, ["Rounding bug"]);
    await openFilters(page);

    await page.getByRole("button", { name: "Clear filters" }).click();

    await expectTitles(page, all);
    expect(params(page)).toEqual({});
    await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue("");
    await expect(select(page, "Type")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Clear filters" })).toHaveCount(0);
  });

  test("sends a search once typing pauses, not on every key", async ({ page }) => {
    await seed(page);
    await showBoard(page);
    const searches: string[] = [];
    page.on("request", (request) => {
      const q = new URL(request.url()).searchParams.get("q");
      if (request.url().includes("/api/tickets") && q) searches.push(q);
    });

    await page
      .getByRole("searchbox", { name: "Search" })
      .pressSequentially("rounding", { delay: 40 });

    await expectTitles(page, ["Rounding bug"]);
    expect(searches).toEqual(["rounding"]);
    expect(params(page)).toEqual({ q: "rounding" });
  });

  test("a new Ticket that does not match the filters stays off the board", async ({ page }) => {
    await seed(page);
    await showBoard(page, "?priority=urgent");
    await expectTitles(page, ["Pay by card"]);

    await page.getByRole("button", { name: "Create ticket" }).click();
    const dialog = page.getByRole("dialog", { name: "Create ticket" });
    await dialog.getByLabel("Title").fill("Calm one");
    await dialog.getByRole("button", { name: "Create ticket" }).click();
    await expect(dialog).toBeHidden();
    await expectTitles(page, ["Pay by card"]);

    await page.getByRole("button", { name: "Create ticket" }).click();
    await dialog.getByLabel("Title").fill("Fire");
    await dialog.getByLabel("Priority").selectOption({ label: "Urgent" });
    await dialog.getByRole("button", { name: "Create ticket" }).click();
    await expectTitles(page, ["Pay by card", "Fire"]);
  });

  test("a new Ticket is placed by Type, Epic, and Assignee as the server would", async ({
    page,
  }) => {
    await seed(page);
    async function create(title: string, type: string, parent?: string) {
      await page.getByRole("button", { name: "Create ticket" }).click();
      const dialog = page.getByRole("dialog", { name: "Create ticket" });
      await dialog.getByLabel("Type").selectOption({ label: type });
      await dialog.getByLabel("Title").fill(title);
      if (parent) await dialog.getByLabel("Parent").selectOption({ label: parent });
      await dialog.getByRole("button", { name: "Create ticket" }).click();
      await expect(dialog).toBeHidden();
    }

    await showBoard(page, "?type=bug&epic=PLAT-1");
    await expectTitles(page, ["Rounding bug"]);
    await create("Wrong type", "Task", "PLAT-1 Checkout");
    await create("Wrong parent", "Bug", "PLAT-2 Other epic");
    await create("No parent", "Bug");
    await expectTitles(page, ["Rounding bug"]);
    await create("Right one", "Bug", "PLAT-1 Checkout");
    await expectTitles(page, ["Rounding bug", "Right one"]);

    // New Tickets have no Assignee, so they belong to Unassigned and not to Any agent.
    await showBoard(page, "?assignee=agents");
    await expectTitles(page, ["Pay by card"]);
    await create("Fresh", "Task");
    await expectTitles(page, ["Pay by card"]);
    await showBoard(page, "?assignee=unassigned");
    await expectTitles(page, [
      "Checkout",
      "Other epic",
      "Write docs",
      "Wrong type",
      "Wrong parent",
      "No parent",
      "Right one",
      "Fresh",
    ]);
    await create("Fresher", "Task");
    await expect(page.getByRole("article", { name: "Fresher" })).toBeVisible();
  });
});

test.describe("archived Tickets", () => {
  async function seedArchived(page: Page) {
    await openBoard(page);
    await createTicket(page, { projectKey: "PLAT", title: "Keep this" });
    const old = await createTicket(page, {
      projectKey: "PLAT",
      title: "Old report",
      priority: "high",
    });
    // The Archive control belongs to the Ticket detail panel, so archive over the API.
    const res = await page.request.post(`/api/tickets/${old.key}/archive`);
    expect(res.status()).toBe(200);
    return old;
  }

  const archivedCard = (page: Page) => page.getByRole("article", { name: "Old report" });

  test("archives, shows archived, and restores a Ticket", async ({ page }) => {
    const old = await seedArchived(page);
    await showBoard(page);
    await expectTitles(page, ["Keep this"]);
    await openFilters(page);

    await page.getByLabel("Show archived").check();

    await expectTitles(page, ["Keep this", "Old report"]);
    expect(params(page)).toEqual({ archived: "true" });
    await expect(archivedCard(page).getByText("Archived", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("article", { name: "Keep this" }).getByText("Archived"),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Restore", exact: false })).toHaveCount(1);

    await page.getByRole("button", { name: "Restore Old report" }).click();

    await expect(archivedCard(page).getByText("Archived", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Restore/ })).toHaveCount(0);
    await expectTitles(page, ["Keep this", "Old report"]);
    const restored = await (await page.request.get(`/api/tickets/${old.key}`)).json();
    expect(restored.ticket.archivedAt).toBeNull();

    // With the toggle off again the restored Ticket is still on the board.
    await page.getByLabel("Show archived").uncheck();
    await expectTitles(page, ["Keep this", "Old report"]);
    expect(params(page)).toEqual({});
    await page.reload();
    await expectTitles(page, ["Keep this", "Old report"]);
  });

  test("the toggle is part of the URL, and turning it off hides them again", async ({ page }) => {
    await seedArchived(page);
    await showBoard(page, "?archived=true");
    await expectTitles(page, ["Keep this", "Old report"]);
    await openFilters(page);
    await expect(page.getByLabel("Show archived")).toBeChecked();

    await page.getByLabel("Show archived").uncheck();

    await expectTitles(page, ["Keep this"]);
    expect(params(page)).toEqual({});
  });

  test("combines with the other filters", async ({ page }) => {
    await seedArchived(page);
    await createTicket(page, { projectKey: "PLAT", title: "Old calm one", priority: "low" });
    await showBoard(page, "?archived=true&priority=high");

    await expectTitles(page, ["Old report"]);
    await expect(archivedCard(page).getByText("Archived", { exact: true })).toBeVisible();
  });

  test("a restored Ticket also returns to the board with archived hidden", async ({ page }) => {
    await seedArchived(page);
    await showBoard(page);
    await expectTitles(page, ["Keep this"]);
    await openFilters(page);
    await page.getByLabel("Show archived").check();
    await expectTitles(page, ["Keep this", "Old report"]);
    await page.getByRole("button", { name: "Restore Old report" }).click();
    await expect(page.getByRole("button", { name: /^Restore/ })).toHaveCount(0);

    // The hidden view was cached before the restore. It must not wait for a refetch.
    await page.getByLabel("Show archived").uncheck();

    await expectTitles(page, ["Keep this", "Old report"]);
  });
});

test.describe("on a phone and on a desktop", () => {
  async function seedBoard(page: Page) {
    await openBoard(page);
    await createTicket(page, { projectKey: "PLAT", title: "Something to do" });
    const old = await createTicket(page, { projectKey: "PLAT", title: "Archived thing" });
    await page.request.post(`/api/tickets/${old.key}/archive`);
  }

  test("filters fold behind a Filters button on a phone and sit in a row on a desktop", async ({
    page,
  }) => {
    await seedBoard(page);
    await showBoard(page);
    const toggle = page.getByRole("button", { name: /^Filters/ });

    if (onPhone(page)) {
      await expect(select(page, "Assignee")).toBeHidden();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(select(page, "Assignee")).toBeVisible();
      await toggle.click();
      await expect(select(page, "Assignee")).toBeHidden();
      // The board is in view while the filters are folded away.
      await expect(page.getByRole("article", { name: "Something to do" })).toBeInViewport();
    } else {
      await expect(toggle).toBeHidden();
      await expect(select(page, "Assignee")).toBeVisible();
      await expect(select(page, "Team")).toBeVisible();
      await expect(page.getByLabel("Show archived")).toBeVisible();
    }
    expect(await scrollsSideways(page)).toBe(false);
  });

  test("the Filters button counts what is on, and the controls are thumb sized", async ({
    page,
  }) => {
    await seedBoard(page);
    await showBoard(page, "?type=task&priority=medium&archived=true");
    if (!onPhone(page)) return;
    const toggle = page.getByRole("button", { name: /^Filters/ });
    await expect(toggle).toContainText("3");
    await toggle.click();

    const heights: Record<string, number | undefined> = {};
    for (const [name, locator] of [
      ["Filters", toggle],
      ["Search", page.getByRole("searchbox", { name: "Search" })],
      ["Assignee", select(page, "Assignee")],
      ["Priority", select(page, "Priority")],
      ["Type", select(page, "Type")],
      ["Epic", select(page, "Epic")],
      ["Team", select(page, "Team")],
      ["Show archived", page.getByText("Show archived")],
      ["Clear filters", page.getByRole("button", { name: "Clear filters" })],
      ["Restore", page.getByRole("button", { name: /^Restore/ })],
    ] as const) {
      heights[name] = (await locator.boundingBox())?.height;
    }
    for (const [name, height] of Object.entries(heights)) {
      expect(height, name).toBeGreaterThanOrEqual(44);
    }
    expect(await scrollsSideways(page)).toBe(false);
    // The search box and the Filters button share one row.
    const searchBox = await page.getByRole("searchbox", { name: "Search" }).boundingBox();
    const toggleBox = await toggle.boundingBox();
    expect(Math.abs((searchBox?.y ?? 0) - (toggleBox?.y ?? 99))).toBeLessThan(2);
  });

  test("filter fields are visible against the page in both themes", async ({ page }) => {
    await seedBoard(page);
    await showBoard(page);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      await openFilters(page);
      const field = select(page, "Assignee");
      await expect(field).toBeVisible();
      const style = await field.evaluate((el) => {
        const css = getComputedStyle(el);
        return {
          border: css.borderTopColor,
          color: css.color,
          page: getComputedStyle(document.body).backgroundColor,
        };
      });
      expect(style.border).not.toBe(style.page);
      expect(style.color).not.toBe(style.page);
    }
  });
});
