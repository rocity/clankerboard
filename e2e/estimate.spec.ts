import { expect, type Page, test } from "@playwright/test";
import { resetDatabase } from "./database";
import { createCompany, createProject, createTicket, scrollsSideways, signUp } from "./helpers";

test.beforeEach(resetDatabase);

// Runs at 1280px in light and at 375px in dark (see playwright.config.ts).

const boardUrl = "/acme-robotics/projects/PLAT";
const card = (page: Page, title: string) => page.getByRole("article", { name: title });

async function setUp(page: Page) {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await createProject(page, { name: "Platform", key: "PLAT" });
}

test.describe("board card", () => {
  test("shows the Estimate when set, zero included, and nothing when blank", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Sized", estimate: 3 });
    await createTicket(page, { projectKey: "PLAT", title: "Trivial", estimate: 0 });
    await createTicket(page, { projectKey: "PLAT", title: "Unsized" });
    await page.goto(boardUrl);

    await expect(card(page, "Sized").getByText("3 pts", { exact: true })).toBeVisible();
    await expect(card(page, "Trivial").getByText("0 pts", { exact: true })).toBeVisible();
    await expect(card(page, "Unsized")).toBeVisible();
    await expect(card(page, "Unsized").getByText(/pts/)).toHaveCount(0);
  });
});

test.describe("create Ticket dialog", () => {
  test("takes an optional Estimate and refuses one out of range", async ({ page }) => {
    await setUp(page);
    await page.goto(boardUrl);
    const dialog = page.getByRole("dialog", { name: "Create ticket" });

    await page.getByRole("button", { name: "Create ticket" }).click();
    await dialog.getByLabel("Title").fill("Sized at birth");
    await dialog.getByLabel("Estimate").fill("101");
    await dialog.getByRole("button", { name: "Create ticket" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Estimates are whole numbers from 0 to 100.",
    );

    await dialog.getByLabel("Estimate").fill("5");
    await dialog.getByRole("button", { name: "Create ticket" }).click();
    await expect(dialog).toBeHidden();
    await expect(card(page, "Sized at birth").getByText("5 pts", { exact: true })).toBeVisible();

    // Left empty, the Estimate stays blank.
    await page.getByRole("button", { name: "Create ticket" }).click();
    await expect(dialog.getByLabel("Estimate")).toHaveValue("");
    await dialog.getByLabel("Title").fill("Sized later");
    await dialog.getByRole("button", { name: "Create ticket" }).click();
    await expect(dialog).toBeHidden();
    await expect(card(page, "Sized later")).toBeVisible();
    await expect(card(page, "Sized later").getByText(/pts/)).toHaveCount(0);
  });
});

const panel = (page: Page, key: string) => page.getByRole("dialog", { name: `Ticket ${key}` });
const timeline = (page: Page, key: string) =>
  panel(page, key).getByRole("region", { name: "Timeline" });

async function openTicket(page: Page, key: string) {
  await page.goto(`${boardUrl}/tickets/${key}`);
  const dialog = panel(page, key);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function estimateOf(page: Page, key: string) {
  const res = await page.request.get(`/api/tickets/${key}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { ticket: { estimate: number | null } }).ticket.estimate;
}

test.describe("Ticket detail", () => {
  test("says when the Estimate is blank", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Unsized" });
    const dialog = await openTicket(page, "PLAT-1");

    const field = dialog.getByLabel("Estimate");
    await expect(field).toHaveValue("");
    await expect(field).toHaveAttribute("placeholder", "None");
  });

  test("saves on Enter or blur, clears when emptied, and the Timeline and card follow", async ({
    page,
  }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Resize me", estimate: 3 });
    const dialog = await openTicket(page, "PLAT-1");
    const field = dialog.getByLabel("Estimate");
    await expect(field).toHaveValue("3");

    await field.fill("5");
    await field.press("Enter");
    await expect(
      timeline(page, "PLAT-1").getByText("changed the estimate from 3 to 5"),
    ).toBeVisible();
    expect(await estimateOf(page, "PLAT-1")).toBe(5);

    await field.fill("");
    await field.blur();
    await expect(timeline(page, "PLAT-1").getByText("cleared the estimate")).toBeVisible();
    expect(await estimateOf(page, "PLAT-1")).toBeNull();
    await expect(field).toHaveValue("");

    await field.fill("0");
    await field.blur();
    await expect(timeline(page, "PLAT-1").getByText("set the estimate to 0")).toBeVisible();
    expect(await estimateOf(page, "PLAT-1")).toBe(0);

    // Leaving the field unchanged records nothing new.
    await field.focus();
    await field.blur();
    await expect(timeline(page, "PLAT-1").getByRole("listitem")).toHaveCount(4);

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(card(page, "Resize me").getByText("0 pts", { exact: true })).toBeVisible();
  });

  test("shows the server's message on a refusal and puts the field back", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Bounded", estimate: 3 });
    const dialog = await openTicket(page, "PLAT-1");
    const field = dialog.getByLabel("Estimate");

    for (const typed of ["101", "2.5", "-1"]) {
      await field.fill(typed);
      await field.press("Enter");
      await expect(dialog.getByRole("alert")).toHaveText(
        "Estimates are whole numbers from 0 to 100.",
      );
      await expect(field).toHaveValue("3");
    }
    expect(await estimateOf(page, "PLAT-1")).toBe(3);

    // The next good save clears the message.
    await field.fill("8");
    await field.press("Enter");
    await expect(
      timeline(page, "PLAT-1").getByText("changed the estimate from 3 to 8"),
    ).toBeVisible();
    await expect(field).toHaveValue("8");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    expect(await estimateOf(page, "PLAT-1")).toBe(8);
  });
});

test.describe("layout", () => {
  test("fits a phone with every badge on the card and in detail", async ({ page }) => {
    await setUp(page);
    await createTicket(page, {
      projectKey: "PLAT",
      title: "A long title that has to wrap on a narrow phone screen without pushing anything",
      priority: "urgent",
      estimate: 100,
    });
    await page.goto(boardUrl);
    await expect(page.getByText("100 pts", { exact: true })).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);

    const dialog = await openTicket(page, "PLAT-1");
    const field = dialog.getByLabel("Estimate");
    await expect(field).toHaveValue("100");
    expect(await scrollsSideways(page)).toBe(false);
    if ((page.viewportSize()?.width ?? 0) < 768) {
      expect((await field.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("live", () => {
  test("the card follows an Estimate changed elsewhere, without a reload", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Watched" });
    await page.goto(boardUrl);
    await expect(card(page, "Watched")).toBeVisible();

    const set = await page.request.patch("/api/tickets/PLAT-1", { data: { estimate: 13 } });
    expect(set.status()).toBe(200);
    await expect(card(page, "Watched").getByText("13 pts", { exact: true })).toBeVisible();

    const cleared = await page.request.patch("/api/tickets/PLAT-1", { data: { estimate: null } });
    expect(cleared.status()).toBe(200);
    await expect(card(page, "Watched").getByText(/pts/)).toHaveCount(0);
  });
});
