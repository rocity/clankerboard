import { expect, type Locator, type Page, test } from "@playwright/test";
import { resetDatabase } from "./database";
import {
  actAsAgent,
  createAgent,
  createApiKey,
  createCompany,
  createProject,
  createTicket,
  moveTicket,
  scrollsSideways,
  signUp,
} from "./helpers";

test.beforeEach(resetDatabase);

// Runs at 1280px in light and at 375px in dark (see playwright.config.ts).

const onPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;
const boardUrl = (projectKey: string) => `/acme-robotics/projects/${projectKey}`;
const ticketUrl = (key: string, projectKey = "PLAT") => `${boardUrl(projectKey)}/tickets/${key}`;
const panel = (page: Page, key: string) => page.getByRole("dialog", { name: `Ticket ${key}` });
const links = (panelEl: Locator) => panelEl.getByRole("region", { name: "Links" });
const group = (section: Locator, name: string) => section.getByRole("list", { name });

async function setUp(page: Page) {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await createProject(page, { name: "Platform", key: "PLAT" });
}

async function openTicket(page: Page, key: string, projectKey = "PLAT") {
  await page.goto(ticketUrl(key, projectKey));
  const dialog = panel(page, key);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Links two Tickets over REST as the signed-in User. */
async function linkByApi(page: Page, key: string, kind: string, target: string, status = 201) {
  const res = await page.request.post(`/api/tickets/${key}/links`, { data: { kind, target } });
  expect(res.status(), await res.text()).toBe(status);
}

test.describe("listing", () => {
  test("groups Links as Blocked by, Blocks, and Related, with key, type, title, Status, and an archived mark", async ({
    page,
  }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Ship checkout" });
    await createTicket(page, { projectKey: "PLAT", title: "Design the API", type: "story" });
    await createTicket(page, { projectKey: "PLAT", title: "Write the docs" });
    await createTicket(page, { projectKey: "PLAT", title: "Old idea", type: "bug" });
    await linkByApi(page, "PLAT-1", "blocked_by", "PLAT-2");
    await linkByApi(page, "PLAT-1", "blocks", "PLAT-3");
    await linkByApi(page, "PLAT-1", "relates_to", "PLAT-4");
    await moveTicket(page, "PLAT-2", "review");
    expect((await page.request.post("/api/tickets/PLAT-4/archive")).status()).toBe(200);

    const section = links(await openTicket(page, "PLAT-1"));

    const blocker = group(section, "Blocked by").getByRole("link", { name: /Design the API/ });
    await expect(blocker).toContainText("PLAT-2");
    await expect(blocker).toContainText("Review");
    await expect(blocker.getByRole("img", { name: "Story" })).toBeVisible();
    const blocked = group(section, "Blocks").getByRole("link", { name: /Write the docs/ });
    await expect(blocked).toContainText("PLAT-3");
    await expect(blocked).toContainText("Backlog");
    const related = group(section, "Related").getByRole("link", { name: /Old idea/ });
    await expect(related).toContainText("PLAT-4");
    await expect(related).toContainText("Archived");
    await expect(related.getByRole("img", { name: "Bug" })).toBeVisible();
    await expect(blocker).not.toContainText("Archived");
  });
});

test.describe("following", () => {
  test("opens a linked Ticket in its own Project, and one in this Project keeps the board's filters", async ({
    page,
  }) => {
    await setUp(page);
    await createProject(page, { name: "Web", key: "WEB" });
    await createTicket(page, { projectKey: "PLAT", title: "Add the endpoint" });
    await createTicket(page, { projectKey: "PLAT", title: "Same board" });
    await createTicket(page, { projectKey: "WEB", title: "Show the page" });
    await linkByApi(page, "PLAT-1", "blocks", "WEB-1");
    await linkByApi(page, "PLAT-1", "relates_to", "PLAT-2");

    await page.goto(`${ticketUrl("PLAT-1")}?type=task`);
    const section = links(panel(page, "PLAT-1"));
    await section.getByRole("link", { name: /Same board/ }).click();
    await expect(page).toHaveURL(new RegExp(`${ticketUrl("PLAT-2")}\\?type=task$`));
    await expect(panel(page, "PLAT-2").getByRole("heading", { name: "Same board" })).toBeVisible();

    await page.goto(`${ticketUrl("PLAT-1")}?type=task`);
    await section.getByRole("link", { name: /Show the page/ }).click();

    await expect(page).toHaveURL(new RegExp(`${ticketUrl("WEB-1", "WEB")}$`));
    const other = panel(page, "WEB-1");
    await expect(other.getByRole("heading", { name: "Show the page" })).toBeVisible();
    // And back again: WEB-1 is blocked by PLAT-1, which opens on the PLAT board.
    await links(other)
      .getByRole("link", { name: /Add the endpoint/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`${ticketUrl("PLAT-1")}$`));
  });
});

test.describe("blocked", () => {
  test("says a Blocked Ticket is blocked, lists open blockers first, and clears when they finish", async ({
    page,
  }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Ship checkout" });
    await createTicket(page, { projectKey: "PLAT", title: "Finished blocker" });
    await createTicket(page, { projectKey: "PLAT", title: "Open blocker" });
    await createTicket(page, { projectKey: "PLAT", title: "Archived blocker" });
    await createTicket(page, { projectKey: "PLAT", title: "Another open blocker" });
    for (const key of ["PLAT-2", "PLAT-3", "PLAT-4", "PLAT-5"]) {
      await linkByApi(page, "PLAT-1", "blocked_by", key);
    }
    await moveTicket(page, "PLAT-2", "done");
    expect((await page.request.post("/api/tickets/PLAT-4/archive")).status()).toBe(200);
    const section = links(await openTicket(page, "PLAT-1"));

    await expect(section.getByRole("note")).toHaveText("Blocked by PLAT-3 and PLAT-5.");
    const rows = group(section, "Blocked by").getByRole("link");
    await expect(rows).toHaveCount(4);
    const keys = await rows.evaluateAll((els) =>
      els.map((el) => el.querySelector(".font-mono")?.textContent),
    );
    expect(keys).toEqual(["PLAT-3", "PLAT-5", "PLAT-2", "PLAT-4"]);

    // The open panel follows the blockers as they finish, without a reload.
    await moveTicket(page, "PLAT-3", "done");
    await expect(section.getByRole("note")).toHaveText("Blocked by PLAT-5.");
    await moveTicket(page, "PLAT-5", "done");
    await expect(section.getByRole("note")).toHaveCount(0);
    await expect(
      group(section, "Blocked by").getByRole("link", { name: /Another open/ }),
    ).toContainText("Done");
  });

  test("says nothing for a Ticket whose blockers are all finished", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Ship checkout" });
    await createTicket(page, { projectKey: "PLAT", title: "Done already" });
    await linkByApi(page, "PLAT-1", "blocked_by", "PLAT-2");
    await moveTicket(page, "PLAT-2", "done");
    const section = links(await openTicket(page, "PLAT-1"));

    await expect(group(section, "Blocked by").getByRole("link")).toHaveCount(1);
    await expect(section.getByRole("note")).toHaveCount(0);
  });
});

/** Adds a Link from the open panel: picks the kind, searches, and picks the Ticket. */
async function addLink(section: Locator, kind: string, search: string, pick: RegExp) {
  await section.getByRole("button", { name: "Add a linked ticket" }).click();
  await section.getByLabel("Kind").selectOption({ label: kind });
  await section.getByLabel("Find a ticket").fill(search);
  await section.getByRole("button", { name: pick }).click();
}

/** The Timeline's lines, whitespace collapsed. */
async function timelineLines(panelEl: Locator) {
  const items = panelEl.getByRole("region", { name: "Timeline" }).getByRole("listitem");
  return (await items.allInnerTexts()).map((text) => text.replace(/\s+/g, " "));
}

test.describe("adding and removing", () => {
  test("adds Links by searching key or title, removes one, and both Timelines say so", async ({
    page,
  }) => {
    await setUp(page);
    await createProject(page, { name: "Web", key: "WEB" });
    await createTicket(page, { projectKey: "PLAT", title: "Ship checkout" });
    await createTicket(page, { projectKey: "PLAT", title: "Add the endpoint" });
    await createTicket(page, { projectKey: "WEB", title: "Show the page" });
    await createTicket(page, { projectKey: "PLAT", title: "Archived one" });
    expect((await page.request.post("/api/tickets/PLAT-3/archive")).status()).toBe(200);
    const dialog = await openTicket(page, "PLAT-1");
    const section = links(dialog);

    // By title, as blocked by.
    await addLink(section, "Blocked by", "endpoint", /Add the endpoint/);
    const blocker = group(section, "Blocked by").getByRole("link", { name: /Add the endpoint/ });
    await expect(blocker).toContainText("PLAT-2");

    // By key, in another Project, as blocks. Archived and already linked Tickets are not offered.
    await section.getByRole("button", { name: "Add a linked ticket" }).click();
    await section.getByLabel("Find a ticket").fill("plat");
    await expect(section.getByRole("button", { name: /Archived one/ })).toHaveCount(0);
    await expect(section.getByRole("button", { name: /Add the endpoint/ })).toHaveCount(0);
    await expect(section.getByRole("button", { name: /Ship checkout/ })).toHaveCount(0);
    await section.getByRole("button", { name: "Cancel" }).click();
    await addLink(section, "Blocks", "web-1", /Show the page/);
    await expect(
      group(section, "Blocks").getByRole("link", { name: /Show the page/ }),
    ).toBeVisible();

    await section.getByRole("button", { name: "Unlink PLAT-2" }).click();
    await expect(group(section, "Blocked by")).toHaveCount(0);
    await expect(blocker).toHaveCount(0);

    await expect
      .poll(() => timelineLines(dialog))
      .toEqual([
        expect.stringContaining("Ada created this ticket"),
        expect.stringContaining("Ada marked this as blocked by PLAT-2"),
        expect.stringContaining("Ada marked PLAT-2 as blocking this, so this is blocked"),
        expect.stringContaining("Ada marked this as blocking WEB-1"),
        expect.stringContaining("Ada removed the link to PLAT-2"),
        expect.stringContaining("Ada removed the link to PLAT-2, so this is no longer blocked"),
      ]);

    // The other side reads from its own point of view.
    await page.goto(ticketUrl("WEB-1", "WEB"));
    const other = panel(page, "WEB-1");
    await expect
      .poll(() => timelineLines(other))
      .toEqual([
        expect.stringContaining("Ada created this ticket"),
        expect.stringContaining("Ada marked this as blocked by PLAT-1"),
        expect.stringContaining("Ada marked PLAT-1 as blocking this, so this is blocked"),
      ]);
    await page.goto(ticketUrl("PLAT-2"));
    await expect
      .poll(() => timelineLines(panel(page, "PLAT-2")))
      .toEqual([
        expect.stringContaining("Ada created this ticket"),
        expect.stringContaining("Ada marked this as blocking PLAT-1"),
        expect.stringContaining("Ada removed the link to PLAT-1"),
      ]);
  });

  test("links two Tickets as related, from either side's Timeline", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Ship checkout" });
    await createTicket(page, { projectKey: "PLAT", title: "Same bug, other side" });
    const dialog = await openTicket(page, "PLAT-1");

    await addLink(links(dialog), "Relates to", "other side", /Same bug, other side/);

    await expect(
      group(links(dialog), "Related").getByRole("link", { name: /Same bug/ }),
    ).toBeVisible();
    await expect
      .poll(async () => (await timelineLines(dialog)).at(-1))
      .toContain("Ada linked this to PLAT-2");
    await page.goto(ticketUrl("PLAT-2"));
    await expect
      .poll(async () => (await timelineLines(panel(page, "PLAT-2"))).at(-1))
      .toContain("Ada linked this to PLAT-1");
  });

  test("shows the server's refusal, such as a Blocks cycle", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "First" });
    await createTicket(page, { projectKey: "PLAT", title: "Second" });
    await createTicket(page, { projectKey: "PLAT", title: "Third" });
    await linkByApi(page, "PLAT-1", "blocks", "PLAT-2");
    await linkByApi(page, "PLAT-2", "blocks", "PLAT-3");
    const dialog = await openTicket(page, "PLAT-3");

    await addLink(links(dialog), "Blocks", "First", /First/);

    await expect(links(dialog).getByRole("alert")).toHaveText(
      "PLAT-3 can't block PLAT-1 because PLAT-1 already blocks PLAT-3 through PLAT-2.",
    );
    await expect(group(links(dialog), "Blocks")).toHaveCount(0);
  });

  test("offers no way to add a Link to an archived Ticket, but still removes one", async ({
    page,
  }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Frozen" });
    await createTicket(page, { projectKey: "PLAT", title: "Neighbour" });
    await linkByApi(page, "PLAT-1", "relates_to", "PLAT-2");
    expect((await page.request.post("/api/tickets/PLAT-1/archive")).status()).toBe(200);
    const section = links(await openTicket(page, "PLAT-1"));

    await expect(section.getByRole("button", { name: "Add a linked ticket" })).toHaveCount(0);
    await section.getByRole("button", { name: "Unlink PLAT-2" }).click();
    await expect(group(section, "Related")).toHaveCount(0);
  });
});

test.describe("live", () => {
  test("an open panel's Links follow an Agent linking and unlinking, on both Tickets", async ({
    page,
    browser,
  }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Ship checkout" });
    await createTicket(page, { projectKey: "PLAT", title: "Add the endpoint" });
    const agent = await createAgent(page, "Claude-1");
    const asAgent = await actAsAgent(await createApiKey(page, agent.id));
    const dialog = await openTicket(page, "PLAT-1");
    await expect(dialog.getByRole("heading", { name: "Timeline" })).toBeVisible();
    // A second tab has the other Ticket open.
    const { viewport, colorScheme, hasTouch } = test.info().project.use;
    const otherContext = await browser.newContext({
      viewport,
      colorScheme,
      hasTouch,
      storageState: await page.context().storageState(),
    });
    const otherTab = await otherContext.newPage();
    await otherTab.goto(ticketUrl("PLAT-2"));
    const otherDialog = panel(otherTab, "PLAT-2");
    await expect(otherDialog.getByRole("heading", { name: "Timeline" })).toBeVisible();

    const linked = await asAgent.post("/api/tickets/PLAT-2/links", {
      data: { kind: "blocks", target: "PLAT-1" },
    });
    expect(linked.status()).toBe(201);

    const section = links(dialog);
    await expect(
      group(section, "Blocked by").getByRole("link", { name: /Add the endpoint/ }),
    ).toBeVisible();
    await expect(section.getByRole("note")).toHaveText("Blocked by PLAT-2.");
    await expect(
      group(links(otherDialog), "Blocks").getByRole("link", { name: /Ship checkout/ }),
    ).toBeVisible();
    await expect
      .poll(() => timelineLines(dialog))
      .toContainEqual(expect.stringContaining("Claude-1 marked this as blocked by PLAT-2"));

    expect((await asAgent.delete("/api/tickets/PLAT-1/links/PLAT-2")).status()).toBe(204);

    await expect(group(section, "Blocked by")).toHaveCount(0);
    await expect(section.getByRole("note")).toHaveCount(0);
    await expect(group(links(otherDialog), "Blocks")).toHaveCount(0);
    await asAgent.dispose();
    await otherContext.close();
  });
});

test.describe("small screens and themes", () => {
  test("fits the screen with long titles and keeps 44px touch targets on a phone", async ({
    page,
  }) => {
    await setUp(page);
    const long = `${"Reconcile the nightly settlement export ".repeat(4)}${"x".repeat(40)}`;
    await createTicket(page, { projectKey: "PLAT", title: long.slice(0, 200) });
    await createTicket(page, { projectKey: "PLAT", title: `Blocker ${long}`.slice(0, 200) });
    await createTicket(page, { projectKey: "PLAT", title: `Candidate ${long}`.slice(0, 200) });
    await linkByApi(page, "PLAT-1", "blocked_by", "PLAT-2");
    const dialog = await openTicket(page, "PLAT-1");
    const section = links(dialog);
    await section.getByRole("button", { name: "Add a linked ticket" }).click();
    await section.getByLabel("Find a ticket").fill("Candidate");
    await expect(section.getByRole("button", { name: /Candidate/ })).toBeVisible();

    expect(await scrollsSideways(page)).toBe(false);
    await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const overflow = await dialog.evaluate(
      (el) =>
        [el, ...el.querySelectorAll("*")].filter(
          (node) =>
            node.scrollWidth > node.clientWidth + 1 &&
            getComputedStyle(node).overflowX === "visible",
        ).length,
    );
    expect(overflow).toBe(0);

    if (onPhone(page)) {
      const targets = [
        group(section, "Blocked by").getByRole("link"),
        section.getByRole("button", { name: "Unlink PLAT-2" }),
        section.getByLabel("Kind"),
        section.getByLabel("Find a ticket"),
        section.getByRole("button", { name: /Candidate/ }),
        section.getByRole("button", { name: "Cancel" }),
      ];
      for (const target of targets) {
        await target.scrollIntoViewIfNeeded();
        const box = await target.boundingBox();
        const html = await target.evaluate((el) => el.outerHTML.slice(0, 80));
        expect(box?.height, html).toBeGreaterThanOrEqual(44);
        expect(box?.width, html).toBeGreaterThanOrEqual(44);
      }
      await section.getByRole("button", { name: "Cancel" }).click();
      const add = await section.getByRole("button", { name: "Add a linked ticket" }).boundingBox();
      expect(add?.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("keeps the Blocked notice readable in light and dark", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Ship checkout" });
    await createTicket(page, { projectKey: "PLAT", title: "Open blocker" });
    await linkByApi(page, "PLAT-1", "blocked_by", "PLAT-2");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const dialog = await openTicket(page, "PLAT-1");
      const note = links(dialog).getByRole("note");
      await expect(note).toBeVisible();
      const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
      expect(isDark).toBe(scheme === "dark");

      const style = (el: Locator) =>
        el.evaluate((node) => {
          const s = getComputedStyle(node);
          // Colors may be oklch(); a canvas turns any CSS color into RGB.
          const ctx = document.createElement("canvas").getContext("2d");
          if (ctx) {
            ctx.fillStyle = s.color;
            ctx.fillRect(0, 0, 1, 1);
          }
          const [r = 0, g = 0, b = 0] = ctx?.getImageData(0, 0, 1, 1).data ?? [];
          return { lightness: (r + g + b) / 3, background: s.backgroundColor };
        });
      const panelBg = (await style(dialog)).background;
      const { lightness, background } = await style(note);
      expect(background).not.toBe(panelBg);
      // Light text on a dark panel, dark text on a light one.
      if (scheme === "dark") expect(lightness).toBeGreaterThan(150);
      else expect(lightness).toBeLessThan(110);
    }
  });
});
