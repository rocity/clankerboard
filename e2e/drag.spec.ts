import { expect, type Locator, type Page, test } from "@playwright/test";
import { resetDatabase } from "./database";
import {
  createCompany,
  createProject,
  createTicket,
  listTickets,
  moveTicket,
  scrollsSideways,
  signUp,
} from "./helpers";

test.beforeEach(resetDatabase);

// Runs at 1280px in light and at 375px in dark (see playwright.config.ts). At
// 375px a Status is nearly as wide as the screen, so a drag to another Status
// has to scroll the board while the Ticket is held.

const screenshots = process.env.DRAG_SCREENSHOTS;

const lane = (page: Page, label: string) => page.getByRole("region", { name: label });
const ticketIn = (page: Page, label: string, title: string) =>
  lane(page, label).getByRole("article", { name: title });

function titlesIn(page: Page, label: string) {
  return lane(page, label)
    .getByRole("article")
    .evaluateAll((els) => els.map((el) => el.querySelector("h3")?.textContent ?? ""));
}

/** The titles of a Status in the server's own order. */
async function serverTitles(page: Page, status: string) {
  return (await listTickets(page, "PLAT")).filter((t) => t.status === status).map((t) => t.title);
}

async function openBoard(page: Page, titles: string[] = []) {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await createProject(page, { name: "Platform", key: "PLAT" });
  for (const title of titles) await createTicket(page, { projectKey: "PLAT", title });
  await page.goto("/acme-robotics/projects/PLAT");
  await expect(page.getByRole("heading", { name: "Platform" })).toBeVisible();
  if (titles.length > 0) await expect(page.getByRole("article")).toHaveCount(titles.length);
}

/** Where a held Ticket is let go: on a Status, or on the top or bottom edge of a Ticket. */
type Drop = { status: string } | { ticket: Locator; half: "top" | "bottom" };

/** The box of an element once it has stopped moving, for example after the board scrolled to it. */
async function stableBox(locator: Locator) {
  let last = await locator.boundingBox();
  for (let i = 0; i < 40; i++) {
    await locator.page().waitForTimeout(50);
    const box = await locator.boundingBox();
    if (box && last && box.x === last.x && box.y === last.y) return box;
    last = box;
  }
  throw new Error("The element keeps moving.");
}

/**
 * Drags a Ticket with the mouse and lets go. The browser's own drag and drop
 * runs, so the pointer carries it. When the drop is off screen (a phone shows
 * one Status at a time) the pointer rests at the edge until the board has
 * scrolled to it.
 */
async function mouseDrag(page: Page, source: Locator, drop: Drop) {
  await source.scrollIntoViewIfNeeded();
  const from = await stableBox(source);
  const startX = from.x + from.width / 2;
  const startY = from.y + from.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 12, startY + 12, { steps: 4 });

  const target = "status" in drop ? lane(page, drop.status) : drop.ticket;
  const screen = page.viewportSize()?.width ?? 1280;
  for (let i = 0; i < 120; i++) {
    const box = await target.boundingBox();
    if (!box) throw new Error("The drop target is not on the page.");
    const visible = Math.min(box.x + box.width, screen) - Math.max(box.x, 0);
    if (visible >= Math.min(box.width, 160)) break;
    await page.mouse.move(box.x > screen / 2 ? screen - 6 : 6, startY, { steps: 2 });
    await page.waitForTimeout(25);
  }
  // Leave the edge at once, or the board keeps scrolling past the target.
  const phone = screen < 768;
  const keepClear = (x: number) =>
    phone ? Math.min(Math.max(x, screen * 0.35), screen * 0.65) : x;
  const rough = await target.boundingBox();
  if (phone && rough) {
    await page.mouse.move(keepClear(rough.x + rough.width / 2), startY, { steps: 2 });
  }
  await page.waitForTimeout(200);
  const box = await stableBox(target);
  const left = Math.max(box.x, 0);
  const x = keepClear(left + (Math.min(box.x + box.width, screen) - left) / 2);
  let y = Math.min(box.y + 60, box.y + box.height - 6);
  if ("ticket" in drop) y = drop.half === "top" ? box.y + 8 : box.y + box.height - 8;
  await page.mouse.move(x, y, { steps: 8 });
  // The browser reports the first position over a drop target late, so keep moving a little.
  for (let i = 1; i <= 3; i++) {
    await page.waitForTimeout(60);
    await page.mouse.move(x + i, y);
  }
  if (screenshots) {
    await page.screenshot({ path: `${screenshots}/held-${test.info().project.name}.png` });
  }
  await page.mouse.up();
}

const waitForMove = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/move") && r.request().method() === "POST");

test("flow 1: sign up, create a Company, a Project and a Ticket, drag it to In Progress, reload, it stays", async ({
  page,
}) => {
  await signUp(page, "Ada", "ada@example.com");
  await expect(page.getByRole("heading", { name: "Create your company" })).toBeVisible();
  await page.getByLabel("Company name").fill("Acme Robotics");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL("/acme-robotics");

  await page.getByRole("button", { name: "Create project" }).first().click();
  const projectDialog = page.getByRole("dialog", { name: "Create project" });
  await projectDialog.getByLabel("Name").fill("Platform");
  await projectDialog.getByLabel("Project Key").fill("plat");
  await projectDialog.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL("/acme-robotics/projects/PLAT");

  await page.getByRole("button", { name: "Create ticket" }).click();
  const ticketDialog = page.getByRole("dialog", { name: "Create ticket" });
  await ticketDialog.getByLabel("Title").fill("Ship the board");
  await ticketDialog.getByRole("button", { name: "Create ticket" }).click();
  await expect(ticketIn(page, "Backlog", "Ship the board")).toBeVisible();
  await expect(ticketDialog).toBeHidden();

  const moved = waitForMove(page);
  await mouseDrag(page, ticketIn(page, "Backlog", "Ship the board"), { status: "In Progress" });

  await expect(ticketIn(page, "In Progress", "Ship the board")).toBeVisible();
  await expect(ticketIn(page, "Backlog", "Ship the board")).toHaveCount(0);
  expect((await moved).status()).toBe(200);
  // Letting go over a Ticket's link does not open it.
  await expect(page).toHaveURL("/acme-robotics/projects/PLAT");

  await page.reload();
  await expect(ticketIn(page, "In Progress", "Ship the board")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  expect(await serverTitles(page, "in_progress")).toEqual(["Ship the board"]);
});

test("reorders Tickets within a Status", async ({ page }) => {
  await openBoard(page, ["A", "B", "C"]);

  const request = page.waitForRequest((r) => r.url().includes("/move"));
  const moved = waitForMove(page);
  await mouseDrag(page, ticketIn(page, "Backlog", "C"), {
    ticket: ticketIn(page, "Backlog", "A"),
    half: "top",
  });

  await expect.poll(() => titlesIn(page, "Backlog")).toEqual(["C", "A", "B"]);
  // At the top there is only a Ticket after it.
  expect((await request).postDataJSON()).toEqual({ status: "backlog", before: "PLAT-1" });
  await moved;
  expect(await serverTitles(page, "backlog")).toEqual(["C", "A", "B"]);
  await page.reload();
  await expect.poll(() => titlesIn(page, "Backlog")).toEqual(["C", "A", "B"]);

  // And down to the bottom.
  const again = waitForMove(page);
  await mouseDrag(page, ticketIn(page, "Backlog", "C"), {
    ticket: ticketIn(page, "Backlog", "B"),
    half: "bottom",
  });
  await expect.poll(() => titlesIn(page, "Backlog")).toEqual(["A", "B", "C"]);
  await again;
  expect(await serverTitles(page, "backlog")).toEqual(["A", "B", "C"]);
});

test("drops between two Tickets of another Status, and sends both as neighbours", async ({
  page,
}) => {
  await openBoard(page, ["One", "Two", "Three", "Four"]);
  await moveTicket(page, "PLAT-2", "todo");
  await moveTicket(page, "PLAT-3", "todo");
  await page.reload();
  await expect(ticketIn(page, "To Do", "Two")).toBeVisible();

  const request = page.waitForRequest((r) => r.url().includes("/move"));
  await mouseDrag(page, ticketIn(page, "Backlog", "One"), {
    ticket: ticketIn(page, "To Do", "Three"),
    half: "top",
  });

  expect((await request).postDataJSON()).toEqual({
    status: "todo",
    after: "PLAT-2",
    before: "PLAT-3",
  });
  await expect.poll(() => titlesIn(page, "To Do")).toEqual(["Two", "One", "Three"]);
  await expect.poll(() => titlesIn(page, "Backlog")).toEqual(["Four"]);
  await page.reload();
  await expect.poll(() => titlesIn(page, "To Do")).toEqual(["Two", "One", "Three"]);
  expect(await serverTitles(page, "todo")).toEqual(["Two", "One", "Three"]);
});

test("drops onto an empty Status and onto the top and bottom of a full one", async ({ page }) => {
  await openBoard(page, ["One", "Two", "Three"]);

  await mouseDrag(page, ticketIn(page, "Backlog", "Two"), { status: "Review" });
  await expect(ticketIn(page, "Review", "Two")).toBeVisible();
  await expect(lane(page, "Review")).toContainText("1");

  await mouseDrag(page, ticketIn(page, "Backlog", "One"), { status: "Review" });
  await expect.poll(() => titlesIn(page, "Review")).toHaveLength(2);

  await page.reload();
  await expect.poll(() => titlesIn(page, "Review")).toEqual(await serverTitles(page, "review"));
  await expect.poll(() => titlesIn(page, "Backlog")).toEqual(["Three"]);
  await expect(lane(page, "Backlog")).toContainText("1");
});

test("a drop shows at once, before the server has answered", async ({ page }) => {
  await openBoard(page, ["Fast"]);
  await page.route("**/api/tickets/*/move", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue();
  });

  const settled = waitForMove(page);
  await mouseDrag(page, ticketIn(page, "Backlog", "Fast"), { status: "To Do" });

  await expect(ticketIn(page, "To Do", "Fast")).toBeVisible({ timeout: 1000 });
  await expect(ticketIn(page, "Backlog", "Fast")).toHaveCount(0);
  expect(await serverTitles(page, "todo")).toEqual([]);

  expect((await settled).status()).toBe(200);
  await expect(ticketIn(page, "To Do", "Fast")).toBeVisible();
  expect(await serverTitles(page, "todo")).toEqual(["Fast"]);
});

test("snaps back with a short message when the server refuses", async ({ page }) => {
  await openBoard(page, ["A", "B"]);
  await page.route("**/api/tickets/*/move", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Those tickets are no longer next to each other. Refresh and try again.",
      }),
    }),
  );

  const refused = waitForMove(page);
  await mouseDrag(page, ticketIn(page, "Backlog", "B"), { status: "Done" });
  await refused;

  const toast = page.getByText("PLAT-2 did not move.");
  await expect(toast).toBeVisible();
  await expect(page.getByText("no longer next to each other")).toBeVisible();
  await expect(ticketIn(page, "Backlog", "B")).toBeVisible();
  await expect(ticketIn(page, "Done", "B")).toHaveCount(0);
  await expect.poll(() => titlesIn(page, "Backlog")).toEqual(["A", "B"]);
  expect(await serverTitles(page, "backlog")).toEqual(["A", "B"]);
  expect(await scrollsSideways(page)).toBe(false);
  if (screenshots) {
    await page.screenshot({ path: `${screenshots}/refused-${test.info().project.name}.png` });
  }
});

test("snaps back when the network fails", async ({ page }) => {
  await openBoard(page, ["A"]);
  await page.route("**/api/tickets/*/move", (route) => route.abort());

  await mouseDrag(page, ticketIn(page, "Backlog", "A"), { status: "Review" });

  await expect(page.getByText("PLAT-1 did not move.")).toBeVisible();
  await expect(ticketIn(page, "Backlog", "A")).toBeVisible();
  await expect(ticketIn(page, "Review", "A")).toHaveCount(0);
});

test("dropping a Ticket where it was sends nothing", async ({ page }) => {
  await openBoard(page, ["A", "B"]);
  let moves = 0;
  await page.route("**/api/tickets/*/move", (route) => {
    moves += 1;
    return route.continue();
  });

  await mouseDrag(page, ticketIn(page, "Backlog", "A"), {
    ticket: ticketIn(page, "Backlog", "A"),
    half: "top",
  });
  await page.waitForTimeout(300);

  expect(moves).toBe(0);
  await expect.poll(() => titlesIn(page, "Backlog")).toEqual(["A", "B"]);
});

test("a click is not a drag", async ({ page }) => {
  await openBoard(page, ["A"]);
  let moves = 0;
  await page.route("**/api/tickets/*/move", (route) => {
    moves += 1;
    return route.continue();
  });

  await ticketIn(page, "Backlog", "A").click();
  await page.waitForTimeout(200);

  expect(moves).toBe(0);
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  test("a quick swipe still scrolls the board and moves nothing", async ({ page }) => {
    await openBoard(page, ["A", "B"]);
    for (let i = 0; i < 12; i++)
      await createTicket(page, { projectKey: "PLAT", title: `Fill ${i}` });
    await page.reload();
    await expect(page.getByRole("article")).toHaveCount(14);
    let moves = 0;
    await page.route("**/api/tickets/*/move", (route) => {
      moves += 1;
      return route.continue();
    });
    const session = await page.context().newCDPSession(page);
    const touch = (type: string, x: number, y: number) =>
      session.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y }],
      });
    const width = page.viewportSize()?.width ?? 1280;
    const height = page.viewportSize()?.height ?? 800;
    const before = await page.evaluate(() => window.scrollY);

    // Swipe up on a Ticket: the page scrolls.
    await touch("touchStart", width / 2, height * 0.8);
    for (let i = 1; i <= 10; i++) {
      await touch("touchMove", width / 2, height * 0.8 - i * 40);
      await page.waitForTimeout(10);
    }
    await touch("touchEnd", 0, 0);
    await page.waitForTimeout(300);

    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
    expect(moves).toBe(0);

    if (width < 768) {
      // Swipe left on a Ticket: the board scrolls to the next Status.
      await page.evaluate(() => window.scrollTo(0, 0));
      const scroller = page.getByTestId("board-scroller");
      const at = await scroller.evaluate((el) => el.scrollLeft);
      const onTicket = await ticketIn(page, "Backlog", "A").boundingBox();
      const y = (onTicket?.y ?? 200) + (onTicket?.height ?? 0) / 2;
      await touch("touchStart", width * 0.8, y);
      for (let i = 1; i <= 10; i++) {
        await touch("touchMove", width * 0.8 - i * 25, y);
        await page.waitForTimeout(10);
      }
      await touch("touchEnd", 0, 0);
      await page.waitForTimeout(500);
      expect(await scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(at);
      expect(moves).toBe(0);
    }
  });
});

test("a line shows where the Ticket will land, and the Ticket in hand is faded, in both themes", async ({
  page,
}) => {
  await openBoard(page, ["Held", "Other"]);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload();
    const source = ticketIn(page, "Backlog", "Held");
    const target = await stableBox(ticketIn(page, "Backlog", "Other"));
    const from = await stableBox(source);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + 20, { steps: 4 });
    const line = page.getByTestId("drop-indicator");
    // The browser reports the first position over a Ticket a moment late, so keep the pointer moving.
    let nudge = 0;
    await expect(async () => {
      nudge += 1;
      await page.mouse.move(
        target.x + target.width / 2 + (nudge % 3),
        target.y + target.height - 8,
        { steps: 2 },
      );
      await expect(line).toBeVisible({ timeout: 300 });
    }).toPass();
    await expect(line).toHaveAttribute("data-edge", "bottom");
    const colors = await line.evaluate((node) => ({
      line: getComputedStyle(node).backgroundColor,
      lane: getComputedStyle(node.closest("section") ?? document.body).backgroundColor,
    }));
    expect(colors.line).not.toBe(colors.lane);
    expect(colors.line).not.toBe("rgba(0, 0, 0, 0)");
    await expect(page.locator("[data-dragging]")).toHaveCount(1);
    if (screenshots) {
      await page.screenshot({
        path: `${screenshots}/line-${scheme}-${test.info().project.name}.png`,
      });
    }
    // Dropped outside any Status, nothing moves.
    await page.mouse.move(2, 2, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByTestId("drop-indicator")).toHaveCount(0);
    await expect.poll(() => titlesIn(page, "Backlog")).toEqual(["Held", "Other"]);
  }
});

test("an archived Ticket cannot be dragged", async ({ page }) => {
  await openBoard(page, ["Live", "Old"]);
  const res = await page.request.post("/api/tickets/PLAT-2/archive");
  expect(res.status()).toBe(200);
  await page.goto("/acme-robotics/projects/PLAT?archived=true");
  await expect(page.getByRole("article")).toHaveCount(2);
  let moves = 0;
  await page.route("**/api/tickets/*/move", (route) => {
    moves += 1;
    return route.continue();
  });

  await mouseDrag(page, ticketIn(page, "Backlog", "Old"), { status: "Review" });
  await page.waitForTimeout(300);

  expect(moves).toBe(0);
  await expect(ticketIn(page, "Backlog", "Old")).toBeVisible();
});
