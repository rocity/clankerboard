import { type Locator, type Page, test } from "@playwright/test";

const screenshots = process.env.DRAG_SCREENSHOTS;

export const lane = (page: Page, label: string) => page.getByRole("region", { name: label });

/** Where a held Ticket is let go: on a Status, or on the top or bottom edge of a Ticket. */
export type Drop = { status: string } | { ticket: Locator; half: "top" | "bottom" };

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
export async function mouseDrag(page: Page, source: Locator, drop: Drop) {
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
