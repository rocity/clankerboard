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

/** The titles of a Status as drawn, top to bottom. While a Ticket is held, the drawing differs from the list's order. */
function titlesAsDrawn(page: Page, label: string) {
  return lane(page, label)
    .getByRole("article")
    .evaluateAll((els) =>
      els
        .map((el) => ({
          top: el.getBoundingClientRect().top,
          title: el.querySelector("h3")?.textContent ?? "",
        }))
        .sort((a, b) => a.top - b.top)
        .map((e) => e.title),
    );
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

/** Where a held Ticket is let go: on a Status, or on the top or bottom half of a Ticket. */
type Drop = { status: string } | { ticket: Locator; half: "top" | "bottom" };

type Pointer = {
  down(x: number, y: number): Promise<void>;
  move(x: number, y: number): Promise<void>;
  up(): Promise<void>;
};

function mousePointer(page: Page): Pointer {
  return {
    down: async (x, y) => {
      await page.mouse.move(x, y);
      await page.mouse.down();
    },
    move: async (x, y) => page.mouse.move(x, y, { steps: 6 }),
    up: async () => page.mouse.up(),
  };
}

/** Touch events need the browser's own protocol: Playwright only offers taps. */
async function touchPointer(page: Page): Promise<Pointer> {
  const session = await page.context().newCDPSession(page);
  let at = { x: 0, y: 0 };
  const send = (type: string, points: { x: number; y: number }[]) =>
    session.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  return {
    down: async (x, y) => {
      at = { x, y };
      await send("touchStart", [at]);
      // Hold still: the drag only starts after a short press, so a swipe can scroll.
      await page.waitForTimeout(400);
    },
    move: async (x, y) => {
      const steps = 8;
      const from = at;
      for (let i = 1; i <= steps; i++) {
        at = { x: from.x + ((x - from.x) * i) / steps, y: from.y + ((y - from.y) * i) / steps };
        await send("touchMove", [at]);
        await page.waitForTimeout(16);
      }
    },
    up: async () => send("touchEnd", []),
  };
}

const center = (box: { x: number; y: number; width: number; height: number }) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/** The box of an element once it has stopped moving, for example after the board scrolled to it. */
async function stableBox(locator: Locator) {
  let last = await locator.boundingBox();
  for (let i = 0; i < 40; i++) {
    await locator.page().waitForTimeout(50);
    const box = await locator.boundingBox();
    if (box && last && box.x === last.x && box.y === last.y) return box;
    last = box;
  }
  throw new Error("The Ticket keeps moving.");
}

/**
 * Picks the Ticket up, carries it to the drop (scrolling the board by holding it
 * at the edge when the drop is off screen), and lets go.
 */
async function carry(page: Page, pointer: Pointer, source: Locator, drop: Drop) {
  await source.scrollIntoViewIfNeeded();
  const from = await stableBox(source);
  const start = center(from);
  await pointer.down(start.x, start.y);
  await pointer.move(start.x + 12, start.y + 12);

  const target = "status" in drop ? lane(page, drop.status) : drop.ticket;
  const screen = page.viewportSize()?.width ?? 1280;
  for (let i = 0; i < 80; i++) {
    const box = await target.boundingBox();
    if (!box) throw new Error("The drop target is not on the page.");
    const visible = Math.min(box.x + box.width, screen) - Math.max(box.x, 0);
    if (visible >= Math.min(box.width, 160)) break;
    await pointer.move(box.x > screen / 2 ? screen - 6 : 6, start.y);
    await page.waitForTimeout(60);
  }

  const box = await target.boundingBox();
  if (!box) throw new Error("The drop target is not on the page.");
  const left = Math.max(box.x, 0);
  const x = left + (Math.min(box.x + box.width, screen) - left) / 2;
  let y = box.y + box.height / 2;
  if ("ticket" in drop) y = drop.half === "top" ? box.y + 6 : box.y + box.height - 6;
  else y = Math.min(box.y + 60, box.y + box.height - 6);
  await pointer.move(x, y);
  await page.waitForTimeout(150);
  if (screenshots)
    await page.screenshot({ path: `${screenshots}/held-${test.info().project.name}.png` });
  await pointer.up();
  // A new drag cannot start until the dropped Ticket has settled.
  await expect(page.getByTestId("drag-overlay")).toHaveCount(0);
}

/** Focuses a Ticket and holds it with the spacebar, once the arrow keys listen. */
async function holdWithKeyboard(page: Page, key: string) {
  await page.getByRole("listitem").filter({ hasText: key }).focus();
  await page.keyboard.press("Space");
  // The first announcement says the Ticket is held. The arrow keys listen a moment later.
  await expect(page.getByText(new RegExp(`^${key} is over`))).toBeAttached();
  await page.waitForTimeout(300);
}

const mouseDrag = (page: Page, source: Locator, drop: Drop) =>
  carry(page, mousePointer(page), source, drop);

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

  // The keyboard places the Ticket exactly, step by step, so the middle slot is not left to aim.
  const request = page.waitForRequest((r) => r.url().includes("/move"));
  await holdWithKeyboard(page, "PLAT-1");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => titlesIn(page, "To Do")).toHaveLength(3);
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(350);
    const drawn = await titlesAsDrawn(page, "To Do");
    if (drawn.join() === "Two,One,Three") break;
    await page.keyboard.press(drawn.indexOf("One") === 0 ? "ArrowDown" : "ArrowUp");
  }
  await expect.poll(() => titlesAsDrawn(page, "To Do")).toEqual(["Two", "One", "Three"]);
  await page.keyboard.press("Space");

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

test("moves a Ticket with the keyboard", async ({ page }) => {
  await openBoard(page, ["A", "B"]);

  const moved = waitForMove(page);
  await holdWithKeyboard(page, "PLAT-2");
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(250);
  await page.keyboard.press("Space");
  await moved;

  await expect.poll(() => titlesIn(page, "Backlog")).toEqual(["B", "A"]);
  expect(await serverTitles(page, "backlog")).toEqual(["B", "A"]);
});

test.describe("with touch", () => {
  test.use({ hasTouch: true });

  test("a long press picks a Ticket up and carries it to another Status", async ({ page }) => {
    await openBoard(page, ["A", "B"]);
    const pointer = await touchPointer(page);

    const moved = waitForMove(page);
    await carry(page, pointer, ticketIn(page, "Backlog", "B"), { status: "In Progress" });
    await moved;

    await expect(ticketIn(page, "In Progress", "B")).toBeVisible();
    await expect.poll(() => titlesIn(page, "Backlog")).toEqual(["A"]);
    await page.reload();
    await expect(ticketIn(page, "In Progress", "B")).toBeVisible();
    expect(await serverTitles(page, "in_progress")).toEqual(["B"]);
    expect(await scrollsSideways(page)).toBe(false);
  });

  test("a touch reorder within a Status works", async ({ page }) => {
    await openBoard(page, ["A", "B", "C"]);
    const pointer = await touchPointer(page);

    const moved = waitForMove(page);
    await carry(page, pointer, ticketIn(page, "Backlog", "C"), {
      ticket: ticketIn(page, "Backlog", "A"),
      half: "top",
    });
    await moved;

    await expect.poll(() => titlesIn(page, "Backlog")).toEqual(["C", "A", "B"]);
    expect(await serverTitles(page, "backlog")).toEqual(["C", "A", "B"]);
  });

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
      await touch("touchStart", width * 0.8, 200);
      for (let i = 1; i <= 10; i++) {
        await touch("touchMove", width * 0.8 - i * 25, 200);
        await page.waitForTimeout(10);
      }
      await touch("touchEnd", 0, 0);
      await page.waitForTimeout(500);
      expect(await scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(at);
      expect(moves).toBe(0);
    }
  });
});

test("a held Ticket stands out from its Status in both themes", async ({ page }) => {
  await openBoard(page, ["Visible", "Other"]);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload();
    const ticket = ticketIn(page, "Backlog", "Visible");
    await ticket.scrollIntoViewIfNeeded();
    const box = await ticket.boundingBox();
    if (!box) throw new Error("The Ticket is not on screen.");
    const start = center(box);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 20, start.y + 40, { steps: 6 });
    await page.waitForTimeout(250);

    const held = page.getByTestId("drag-overlay").getByRole("article", { name: "Visible" });
    await expect(held).toBeVisible();
    const colors = await held.evaluate((node) => ({
      card: getComputedStyle(node).backgroundColor,
      lane: getComputedStyle(node.closest("section") ?? document.body).backgroundColor,
      page: getComputedStyle(document.body).backgroundColor,
    }));
    expect(colors.card).not.toBe(colors.page);
    expect(colors.card).not.toBe("rgba(0, 0, 0, 0)");
    if (screenshots) {
      await page.screenshot({
        path: `${screenshots}/overlay-${scheme}-${test.info().project.name}.png`,
      });
    }
    await page.keyboard.press("Escape");
    await page.mouse.up();
    // Escape cancels: nothing moved.
    await expect.poll(() => titlesIn(page, "Backlog")).toEqual(["Visible", "Other"]);
    await expect(page.getByTestId("drag-overlay")).toHaveCount(0);
  }
});
