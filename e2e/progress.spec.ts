import { expect, type Page, test } from "@playwright/test";
import { resetDatabase } from "./database";
import { createCompany, createProject, createTicket, scrollsSideways, signUp } from "./helpers";

test.beforeEach(resetDatabase);

// Runs at 1280px in light and at 375px in dark (see playwright.config.ts).

const boardUrl = "/acme-robotics/projects/PLAT";
const card = (page: Page, title: string) => page.getByRole("article", { name: title });
const bar = (page: Page, title: string) => card(page, title).getByRole("progressbar");

async function setUp(page: Page) {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await createProject(page, { name: "Platform", key: "PLAT" });
}

const panel = (page: Page, key: string) => page.getByRole("dialog", { name: `Ticket ${key}` });
const timeline = (page: Page, key: string) =>
  panel(page, key).getByRole("region", { name: "Timeline" });

async function openTicket(page: Page, key: string) {
  await page.goto(`${boardUrl}/tickets/${key}`);
  const dialog = panel(page, key);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function progressOf(page: Page, key: string) {
  const res = await page.request.get(`/api/tickets/${key}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { ticket: { progress: number | null } }).ticket.progress;
}

test.describe("board card", () => {
  test("shows a bar with the percentage when set, zero included, and nothing when blank", async ({
    page,
  }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Halfway", progress: 50 });
    await createTicket(page, { projectKey: "PLAT", title: "Just begun", progress: 0 });
    await createTicket(page, { projectKey: "PLAT", title: "Unreported" });
    await page.goto(boardUrl);

    await expect(bar(page, "Halfway")).toHaveAccessibleName("50% done");
    await expect(bar(page, "Halfway")).toHaveAttribute("aria-valuenow", "50");
    await expect(card(page, "Halfway").getByText("50%", { exact: true })).toBeVisible();
    await expect(bar(page, "Just begun")).toHaveAccessibleName("0% done");
    await expect(card(page, "Unreported")).toBeVisible();
    await expect(bar(page, "Unreported")).toHaveCount(0);
  });
});

test.describe("Ticket detail", () => {
  test("says when Progress is not reported", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Unreported" });
    const dialog = await openTicket(page, "PLAT-1");

    await expect(dialog.getByLabel("Progress")).toHaveValue("");
    await expect(dialog.getByText("Not reported")).toBeVisible();
    await expect(dialog.getByRole("progressbar")).toHaveCount(0);
  });

  test("saves on Enter or blur, clears when emptied, and the Timeline and card follow", async ({
    page,
  }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Moving along", progress: 40 });
    const dialog = await openTicket(page, "PLAT-1");
    const field = dialog.getByLabel("Progress");
    await expect(field).toHaveValue("40");
    await expect(dialog.getByRole("progressbar")).toHaveAccessibleName("40% done");

    await field.fill("70");
    await field.press("Enter");
    await expect(
      timeline(page, "PLAT-1").getByText("changed progress from 40% to 70%"),
    ).toBeVisible();
    await expect(dialog.getByRole("progressbar")).toHaveAccessibleName("70% done");
    expect(await progressOf(page, "PLAT-1")).toBe(70);

    await field.fill("");
    await field.blur();
    await expect(timeline(page, "PLAT-1").getByText("cleared progress")).toBeVisible();
    expect(await progressOf(page, "PLAT-1")).toBeNull();

    await field.fill("90");
    await field.blur();
    await expect(timeline(page, "PLAT-1").getByText("set progress to 90%")).toBeVisible();

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(bar(page, "Moving along")).toHaveAccessibleName("90% done");
  });

  test("shows the server's message on a refusal and puts the field back", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Bounded", progress: 30 });
    const dialog = await openTicket(page, "PLAT-1");
    const field = dialog.getByLabel("Progress");

    for (const typed of ["101", "12.5", "-1"]) {
      await field.fill(typed);
      await field.press("Enter");
      await expect(dialog.getByRole("alert")).toHaveText(
        "Progress is a whole number from 0 to 100.",
      );
      await expect(field).toHaveValue("30");
    }
    expect(await progressOf(page, "PLAT-1")).toBe(30);
  });
});

test.describe("layout", () => {
  test("fits a phone with the bar on the card and in detail", async ({ page }) => {
    await setUp(page);
    await createTicket(page, {
      projectKey: "PLAT",
      title: "A long title that has to wrap on a narrow phone screen without pushing anything",
      priority: "urgent",
      estimate: 100,
      progress: 100,
    });
    await page.goto(boardUrl);
    await expect(page.getByRole("progressbar", { name: "100% done" })).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);

    const dialog = await openTicket(page, "PLAT-1");
    const field = dialog.getByLabel("Progress");
    await expect(field).toHaveValue("100");
    expect(await scrollsSideways(page)).toBe(false);
    if ((page.viewportSize()?.width ?? 0) < 768) {
      expect((await field.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("live", () => {
  test("the card follows Progress changed elsewhere, without a reload", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Watched" });
    await page.goto(boardUrl);
    await expect(card(page, "Watched")).toBeVisible();

    const set = await page.request.patch("/api/tickets/PLAT-1", { data: { progress: 65 } });
    expect(set.status()).toBe(200);
    await expect(bar(page, "Watched")).toHaveAccessibleName("65% done");

    const cleared = await page.request.patch("/api/tickets/PLAT-1", { data: { progress: null } });
    expect(cleared.status()).toBe(200);
    await expect(bar(page, "Watched")).toHaveCount(0);
  });
});
