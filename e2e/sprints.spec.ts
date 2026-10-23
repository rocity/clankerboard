import { expect, type Page, test } from "@playwright/test";
import { lane } from "./board-drag";
import { resetDatabase } from "./database";
import {
  createCompany,
  createProject,
  createTicket,
  joinCompany,
  moveTicket,
  scrollsSideways,
  signUp,
} from "./helpers";

test.beforeEach(resetDatabase);

// Runs at 1280px in light and at 375px in dark (see playwright.config.ts).

const boardUrl = "/acme-robotics/projects/PLAT";
const card = (page: Page, title: string) => page.getByRole("article", { name: title });
const sprintBar = (page: Page) => page.getByRole("region", { name: "Sprint", exact: true });

async function setUp(page: Page) {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await createProject(page, { name: "Platform", key: "PLAT" });
}

async function api(page: Page, method: "post" | "patch", path: string, data: object = {}) {
  const res = await page.request[method](path, { data });
  expect(res.ok(), `${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

const newSprint = (page: Page, goal = "") =>
  api(page, "post", "/api/projects/PLAT/sprints", { goal });
const startSprint = (page: Page, number: number, data: object = {}) =>
  api(page, "post", `/api/projects/PLAT/sprints/${number}/start`, data);

async function ticketJson(page: Page, key: string) {
  const res = await page.request.get(`/api/tickets/${key}`);
  return (
    (await res.json()) as {
      ticket: { archivedAt: string | null; sprint: { number: number } | null };
    }
  ).ticket;
}

test.describe("board in Sprint mode", () => {
  test("shows every Ticket and no Sprint bar while the Project has no Sprints", async ({
    page,
  }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Anything" });
    await page.goto(boardUrl);

    await expect(card(page, "Anything")).toBeVisible();
    await expect(sprintBar(page)).toHaveCount(0);
  });

  test("shows only the active Sprint's Tickets, with its name, end date, and goal", async ({
    page,
  }) => {
    await setUp(page);
    await newSprint(page, "Ship the login flow");
    await newSprint(page);
    await startSprint(page, 1, { endsOn: "2099-03-14" });
    await createTicket(page, { projectKey: "PLAT", title: "In this sprint", sprint: 1 });
    await createTicket(page, { projectKey: "PLAT", title: "Next sprint", sprint: 2 });
    await createTicket(page, { projectKey: "PLAT", title: "No sprint" });
    await page.goto(boardUrl);

    await expect(sprintBar(page)).toContainText("Sprint 1");
    await expect(sprintBar(page)).toContainText("Ends Mar 14, 2099");
    await expect(sprintBar(page)).toContainText("Ship the login flow");
    await expect(card(page, "In this sprint")).toBeVisible();
    await expect(card(page, "Next sprint")).toHaveCount(0);
    await expect(card(page, "No sprint")).toHaveCount(0);
    expect(await scrollsSideways(page)).toBe(false);
  });

  test("says when no Sprint is active and starts the next one from the bar", async ({ page }) => {
    await setUp(page);
    await newSprint(page);
    await createTicket(page, { projectKey: "PLAT", title: "Planned work", sprint: 1 });
    await page.goto(boardUrl);

    await expect(sprintBar(page)).toContainText(
      "No active sprint. Start Sprint 1 to fill the board.",
    );
    await expect(lane(page, "Backlog")).toHaveCount(0);

    await sprintBar(page).getByRole("button", { name: "Start sprint" }).click();
    const dialog = page.getByRole("dialog", { name: "Start Sprint 1" });
    await expect(dialog.getByLabel("End date")).not.toHaveValue("");
    await dialog.getByLabel("End date").fill("2099-01-31");
    await dialog.getByLabel("Goal").fill("Planned work first");
    await dialog.getByRole("button", { name: "Start sprint" }).click();

    await expect(dialog).toBeHidden();
    await expect(sprintBar(page)).toContainText("Ends Jan 31, 2099");
    await expect(sprintBar(page)).toContainText("Planned work first");
    await expect(card(page, "Planned work")).toBeVisible();
  });

  test("finishes the Sprint after saying what happens, archiving Done and carrying the rest over", async ({
    page,
  }) => {
    await setUp(page);
    await newSprint(page);
    await startSprint(page, 1);
    const done = await createTicket(page, { projectKey: "PLAT", title: "Shipped", sprint: 1 });
    const open = await createTicket(page, { projectKey: "PLAT", title: "Unfinished", sprint: 1 });
    await moveTicket(page, done.key, "done");
    await page.goto(boardUrl);
    await expect(card(page, "Unfinished")).toBeVisible();

    await sprintBar(page).getByRole("button", { name: "Finish sprint" }).click();
    const dialog = page.getByRole("dialog", { name: "Finish Sprint 1?" });
    await expect(dialog).toContainText(
      "1 Done ticket is archived. 1 ticket moves to a new sprint.",
    );
    await dialog.getByRole("button", { name: "Finish sprint" }).click();

    await expect(dialog).toBeHidden();
    await expect(sprintBar(page)).toContainText(
      "No active sprint. Start Sprint 2 to fill the board.",
    );
    await expect(card(page, "Unfinished")).toHaveCount(0);
    expect((await ticketJson(page, done.key)).archivedAt).not.toBeNull();
    expect((await ticketJson(page, open.key)).sprint?.number).toBe(2);
  });

  test("follows another User starting and finishing a Sprint", async ({ page, browser }) => {
    await setUp(page);
    await newSprint(page);
    await createTicket(page, { projectKey: "PLAT", title: "Planned work", sprint: 1 });
    const other = await joinCompany(page, browser, { name: "Bea", email: "bea@example.com" });
    await page.goto(boardUrl);
    await expect(sprintBar(page)).toContainText("No active sprint.");

    await startSprint(other, 1);
    await expect(card(page, "Planned work")).toBeVisible();
    await expect(sprintBar(page)).toContainText("Sprint 1");

    await api(other, "post", "/api/projects/PLAT/sprints/1/finish");
    await expect(sprintBar(page)).toContainText("No active sprint. Start Sprint 2");
    await expect(card(page, "Planned work")).toHaveCount(0);
    await other.context().close();
  });
});

const panel = (page: Page, key: string) => page.getByRole("dialog", { name: `Ticket ${key}` });
const timeline = (page: Page, key: string) =>
  panel(page, key).getByRole("region", { name: "Timeline" });

test.describe("Sprint of a Ticket", () => {
  test("changes in Ticket detail, and the Timeline and board follow", async ({ page }) => {
    await setUp(page);
    await newSprint(page);
    await newSprint(page);
    await startSprint(page, 1);
    const ticket = await createTicket(page, { projectKey: "PLAT", title: "Movable", sprint: 1 });
    await page.goto(`${boardUrl}/tickets/${ticket.key}`);
    const sprint = panel(page, ticket.key).getByLabel("Sprint");
    await expect(sprint).toHaveValue("1");

    await sprint.selectOption({ label: "Sprint 2" });

    await expect(timeline(page, ticket.key)).toContainText("moved this from Sprint 1 to Sprint 2");
    await expect(sprint).toHaveValue("2");
    expect((await ticketJson(page, ticket.key)).sprint?.number).toBe(2);
    await sprint.selectOption({ label: "No sprint" });
    await expect(timeline(page, ticket.key)).toContainText("removed this from Sprint 2");
    await page.keyboard.press("Escape");
    await expect(card(page, "Movable")).toHaveCount(0);
  });

  test("can't be set on an Epic, and an archive at finish names the Sprint in the Timeline", async ({
    page,
  }) => {
    await setUp(page);
    await newSprint(page);
    await startSprint(page, 1);
    const epic = await createTicket(page, { projectKey: "PLAT", title: "Big", type: "epic" });
    const done = await createTicket(page, { projectKey: "PLAT", title: "Shipped", sprint: 1 });
    await moveTicket(page, done.key, "done");
    await api(page, "post", "/api/projects/PLAT/sprints/1/finish");

    await page.goto(`${boardUrl}/tickets/${epic.key}`);
    await expect(panel(page, epic.key).getByLabel("Sprint")).toBeDisabled();
    await page.goto(`${boardUrl}/tickets/${done.key}`);
    await expect(panel(page, done.key).getByLabel("Sprint")).toBeDisabled();
    await expect(panel(page, done.key).getByLabel("Sprint")).toHaveValue("1");
    await expect(timeline(page, done.key)).toContainText(
      "archived this ticket when Sprint 1 finished",
    );
  });

  test("defaults to the active Sprint in the create dialog, and to none for an Epic", async ({
    page,
  }) => {
    await setUp(page);
    await newSprint(page);
    await newSprint(page);
    await startSprint(page, 1);
    await page.goto(boardUrl);

    await page.getByRole("button", { name: "Create ticket" }).click();
    const dialog = page.getByRole("dialog", { name: "Create ticket" });
    await expect(dialog.getByLabel("Sprint")).toHaveValue("1");
    await dialog.getByLabel("Title").fill("Fresh work");
    await dialog.getByRole("button", { name: "Create ticket" }).click();
    await expect(card(page, "Fresh work")).toBeVisible();

    await page.getByRole("button", { name: "Create ticket" }).click();
    await dialog.getByLabel("Type").selectOption("epic");
    await expect(dialog.getByLabel("Sprint")).toBeDisabled();
    await dialog.getByLabel("Title").fill("Broad goal");
    await dialog.getByRole("button", { name: "Create ticket" }).click();
    await expect(dialog).toBeHidden();
    const res = await page.request.get("/api/tickets?projectKey=PLAT&type=epic");
    const { tickets } = (await res.json()) as { tickets: { sprint: unknown }[] };
    expect(tickets).toEqual([expect.objectContaining({ sprint: null })]);
  });
});

const sprintsUrl = `${boardUrl}/sprints`;
const sprintCard = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const row = (page: Page, section: string, key: string) =>
  sprintCard(page, section).getByRole("listitem", { name: new RegExp(`^${key} `) });

test.describe("Sprints page", () => {
  test("plans a Sprint: create it, move Tickets in, set its goal, start it, and delete another", async ({
    page,
  }) => {
    await setUp(page);
    const alpha = await createTicket(page, { projectKey: "PLAT", title: "Alpha" });
    const beta = await createTicket(page, { projectKey: "PLAT", title: "Beta", estimate: 5 });
    await createTicket(page, { projectKey: "PLAT", title: "Theme", type: "epic" });
    await page.goto(boardUrl);
    await page.getByRole("link", { name: "Sprints" }).click();
    await expect(page).toHaveURL(sprintsUrl);
    await expect(page.getByRole("heading", { name: "Sprints" })).toBeVisible();
    await expect(page.getByText("No sprints yet.")).toBeVisible();
    await expect(sprintCard(page, "No sprint").getByRole("listitem")).toHaveCount(2);

    await page.getByRole("button", { name: "Create sprint" }).click();
    await expect(sprintCard(page, "Sprint 1")).toContainText("Planned");
    await page.getByLabel(`Sprint for ${beta.key}`).selectOption({ label: "Sprint 1" });
    await expect(row(page, "Sprint 1", beta.key)).toBeVisible();
    await expect(row(page, "No sprint", beta.key)).toHaveCount(0);
    await expect(sprintCard(page, "Sprint 1")).toContainText("1 ticket · 0 done · 5 pts");
    await page.getByLabel("Goal for Sprint 1").fill("Beta first");
    await page.getByLabel("Goal for Sprint 1").press("Enter");
    await expect
      .poll(async () => {
        const res = await page.request.get("/api/projects/PLAT/sprints");
        return ((await res.json()) as { sprints: { goal: string }[] }).sprints[0]?.goal;
      })
      .toBe("Beta first");

    await sprintCard(page, "Sprint 1").getByRole("button", { name: "Start sprint" }).click();
    const start = page.getByRole("dialog", { name: "Start Sprint 1" });
    await expect(start.getByLabel("Goal")).toHaveValue("Beta first");
    await start.getByRole("button", { name: "Start sprint" }).click();
    await expect(sprintCard(page, "Sprint 1")).toContainText("Active");
    await expect(sprintCard(page, "Sprint 1")).toContainText("Started");

    await page.getByRole("button", { name: "Create sprint" }).click();
    await page.getByLabel(`Sprint for ${alpha.key}`).selectOption({ label: "Sprint 2" });
    await expect(row(page, "Sprint 2", alpha.key)).toBeVisible();
    // Only one Sprint is active at a time.
    await expect(
      sprintCard(page, "Sprint 2").getByRole("button", { name: "Start sprint" }),
    ).toHaveCount(0);
    await sprintCard(page, "Sprint 2").getByRole("button", { name: "Delete Sprint 2" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete Sprint 2?" });
    await expect(confirm).toContainText("Its ticket goes back to no sprint.");
    await confirm.getByRole("button", { name: "Delete sprint" }).click();
    await expect(sprintCard(page, "Sprint 2")).toHaveCount(0);
    await expect(row(page, "No sprint", alpha.key)).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);

    await page.getByRole("link", { name: "Board" }).click();
    await expect(page).toHaveURL(boardUrl);
    await expect(card(page, "Beta")).toBeVisible();
    await expect(card(page, "Alpha")).toHaveCount(0);
  });

  test("finishes the active Sprint and lists it as finished", async ({ page }) => {
    await setUp(page);
    await newSprint(page, "Wrap up");
    await startSprint(page, 1);
    const done = await createTicket(page, { projectKey: "PLAT", title: "Shipped", sprint: 1 });
    const open = await createTicket(page, { projectKey: "PLAT", title: "Carried", sprint: 1 });
    await moveTicket(page, done.key, "done");
    await page.goto(sprintsUrl);

    await sprintCard(page, "Sprint 1").getByRole("button", { name: "Finish sprint" }).click();
    await page
      .getByRole("dialog", { name: "Finish Sprint 1?" })
      .getByRole("button", { name: "Finish sprint" })
      .click();

    await expect(row(page, "Sprint 2", open.key)).toBeVisible();
    const finished = page.getByRole("region", { name: "Finished sprints" });
    await expect(finished).toContainText("Sprint 1");
    await expect(finished).toContainText("Finished");
    await expect(finished).toContainText("Wrap up");
    await expect(page.getByText("Shipped")).toHaveCount(0);
  });
});
