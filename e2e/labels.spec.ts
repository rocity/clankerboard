import { expect, type Page, test } from "@playwright/test";
import { resetDatabase } from "./database";
import { createCompany, createProject, createTicket, scrollsSideways, signUp } from "./helpers";

test.beforeEach(resetDatabase);

// Runs at 1280px in light and at 375px in dark (see playwright.config.ts).

const boardUrl = "/acme-robotics/projects/PLAT";
const onPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;
const card = (page: Page, title: string) => page.getByRole("article", { name: title });
/** The chip names on a card, in order. */
const cardLabels = (page: Page, title: string) =>
  card(page, title).getByRole("list", { name: "Labels" }).getByTestId("label");

const panel = (page: Page, key: string) => page.getByRole("dialog", { name: `Ticket ${key}` });
const timeline = (page: Page, key: string) =>
  panel(page, key).getByRole("region", { name: "Timeline" });

async function setUp(page: Page) {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await createProject(page, { name: "Platform", key: "PLAT" });
}

async function openTicket(page: Page, key: string) {
  await page.goto(`${boardUrl}/tickets/${key}`);
  const dialog = panel(page, key);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function labelsOf(page: Page, key: string) {
  const res = await page.request.get(`/api/tickets/${key}`);
  expect(res.status()).toBe(200);
  const { ticket } = (await res.json()) as { ticket: { labels: { name: string }[] } };
  return ticket.labels.map((label) => label.name);
}

/** On a phone the filters sit behind a "Filters" button. */
async function openFilters(page: Page) {
  if (!onPhone(page)) return;
  const toggle = page.getByRole("button", { name: /^Filters/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

test.describe("board card", () => {
  test("shows up to three Labels in name order, then how many more, and nothing without any", async ({
    page,
  }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Two", labels: ["web", "api"] });
    await createTicket(page, {
      projectKey: "PLAT",
      title: "Five",
      labels: ["e", "d", "c", "b", "a"],
    });
    await createTicket(page, { projectKey: "PLAT", title: "None" });
    await page.goto(boardUrl);

    await expect(cardLabels(page, "Two")).toHaveText(["api", "web"]);
    await expect(cardLabels(page, "Five")).toHaveText(["a", "b", "c"]);
    await expect(card(page, "Five").getByLabel("2 more labels")).toHaveText("+2");
    await expect(card(page, "None")).toBeVisible();
    await expect(card(page, "None").getByRole("list", { name: "Labels" })).toHaveCount(0);
  });
});

test.describe("Ticket detail", () => {
  test("adds a new Label and an existing one by typing, removes one by its chip, and the Timeline and card follow", async ({
    page,
  }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Seed", labels: ["Backend"] });
    await createTicket(page, { projectKey: "PLAT", title: "Group me" });
    const dialog = await openTicket(page, "PLAT-2");
    const input = dialog.getByLabel("Labels", { exact: true });
    const chips = dialog.getByRole("list", { name: "Labels on this ticket" }).getByTestId("label");

    await input.fill("api");
    await input.press("Enter");
    await expect(timeline(page, "PLAT-2").getByText("added the label api")).toBeVisible();
    await expect(chips).toHaveText(["api"]);
    await expect(input).toHaveValue("");

    // An existing Label typed in another case is added as it is spelled.
    await input.fill("backend");
    await input.press("Enter");
    await expect(timeline(page, "PLAT-2").getByText("added the label Backend")).toBeVisible();
    await expect(chips).toHaveText(["api", "Backend"]);
    expect(await labelsOf(page, "PLAT-2")).toEqual(["api", "Backend"]);

    // Typing one it already has changes nothing.
    await input.fill("API");
    await input.press("Enter");
    await expect(input).toHaveValue("");
    await expect(chips).toHaveText(["api", "Backend"]);

    await dialog.getByRole("button", { name: "Remove label api" }).click();
    await expect(timeline(page, "PLAT-2").getByText("removed the label api")).toBeVisible();
    await expect(chips).toHaveText(["Backend"]);
    expect(await labelsOf(page, "PLAT-2")).toEqual(["Backend"]);

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(cardLabels(page, "Group me")).toHaveText(["Backend"]);
  });

  test("suggests the Company's other Labels", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Seed", labels: ["api", "web"] });
    await createTicket(page, { projectKey: "PLAT", title: "Pick", labels: ["web"] });
    const dialog = await openTicket(page, "PLAT-2");

    const suggestions = dialog.locator("datalist option");
    await expect(suggestions).toHaveCount(1);
    await expect(suggestions).toHaveAttribute("value", "api");
  });

  test("shows the server's message when a Ticket has too many Labels", async ({ page }) => {
    await setUp(page);
    const ten = Array.from({ length: 10 }, (_, i) => `l${i}`);
    await createTicket(page, { projectKey: "PLAT", title: "Full", labels: ten });
    const dialog = await openTicket(page, "PLAT-1");
    const input = dialog.getByLabel("Labels", { exact: true });

    await input.fill("eleventh");
    await input.press("Enter");

    await expect(dialog.getByRole("alert")).toHaveText("A ticket can have up to 10 labels.");
    expect(await labelsOf(page, "PLAT-1")).toHaveLength(10);
  });
});

test.describe("create Ticket dialog", () => {
  test("takes Labels, and the new Ticket carries them", async ({ page }) => {
    await setUp(page);
    await page.goto(boardUrl);
    const dialog = page.getByRole("dialog", { name: "Create ticket" });

    await page.getByRole("button", { name: "Create ticket" }).click();
    await dialog.getByLabel("Title").fill("Labelled at birth");
    const input = dialog.getByLabel("Labels", { exact: true });
    await input.fill("api");
    // Enter adds the Label rather than submitting the form.
    await input.press("Enter");
    await expect(dialog).toBeVisible();
    await input.fill("web");
    await input.press("Enter");
    await dialog.getByRole("button", { name: "Remove label web" }).click();
    await dialog.getByRole("button", { name: "Create ticket" }).click();

    await expect(dialog).toBeHidden();
    await expect(cardLabels(page, "Labelled at birth")).toHaveText(["api"]);

    // The next dialog starts empty.
    await page.getByRole("button", { name: "Create ticket" }).click();
    await expect(dialog.getByTestId("label")).toHaveCount(0);
  });
});

test.describe("filter", () => {
  test("narrows the board to one Label, holds it in the URL, and places live changes by it", async ({
    page,
  }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "API work", labels: ["api"] });
    await createTicket(page, { projectKey: "PLAT", title: "Web work", labels: ["web"] });
    await createTicket(page, { projectKey: "PLAT", title: "Later API work" });
    await page.goto(boardUrl);
    await expect(page.getByRole("article")).toHaveCount(3);

    await openFilters(page);
    await page.getByRole("combobox", { name: "Label", exact: true }).selectOption("api");

    await expect(page).toHaveURL(/[?&]label=api/);
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(card(page, "API work")).toBeVisible();

    // Labelled elsewhere, it joins the filtered board without a reload.
    const res = await page.request.patch("/api/tickets/PLAT-3", { data: { labels: ["API"] } });
    expect(res.status()).toBe(200);
    await expect(card(page, "Later API work")).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(2);

    // A shared link opens filtered.
    await page.goto(`${boardUrl}?label=web`);
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(card(page, "Web work")).toBeVisible();
  });
});

test.describe("live", () => {
  test("a card follows Labels changed elsewhere, without a reload", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Watched" });
    await page.goto(boardUrl);
    await expect(card(page, "Watched")).toBeVisible();

    const set = await page.request.patch("/api/tickets/PLAT-1", { data: { labels: ["ops"] } });
    expect(set.status()).toBe(200);
    await expect(cardLabels(page, "Watched")).toHaveText(["ops"]);

    const cleared = await page.request.patch("/api/tickets/PLAT-1", { data: { labels: [] } });
    expect(cleared.status()).toBe(200);
    await expect(card(page, "Watched").getByTestId("label")).toHaveCount(0);
  });
});

test.describe("layout", () => {
  test("fits a phone with long Labels on the card and in detail", async ({ page }) => {
    await setUp(page);
    await createTicket(page, {
      projectKey: "PLAT",
      title: "A long title that has to wrap on a narrow phone screen without pushing anything",
      labels: ["a-very-long-label-name-thirty", "another-long-label-name-here", "third", "fourth"],
    });
    await page.goto(boardUrl);
    await expect(page.getByText("+1", { exact: true })).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);

    const dialog = await openTicket(page, "PLAT-1");
    const input = dialog.getByLabel("Labels", { exact: true });
    await expect(input).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);
    if (onPhone(page)) {
      const remove = dialog.getByRole("button", { name: "Remove label third" });
      expect((await remove.boundingBox())?.height).toBeGreaterThanOrEqual(24);
    }
  });
});
