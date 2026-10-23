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
