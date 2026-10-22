import { expect, type Locator, type Page, test } from "@playwright/test";
import { resetDatabase } from "./database";
import {
  actAsAgent,
  addComment,
  assignTicket,
  createAgent,
  createApiKey,
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

const onPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;
const boardUrl = "/acme-robotics/projects/PLAT";
const ticketUrl = (key: string) => `${boardUrl}/tickets/${key}`;
const panel = (page: Page, key: string) => page.getByRole("dialog", { name: `Ticket ${key}` });
const timeline = (panelEl: Locator) => panelEl.getByRole("region", { name: "Timeline" });

async function setUp(page: Page) {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await createProject(page, { name: "Platform", key: "PLAT" });
}

async function openTicket(page: Page, key: string) {
  await page.goto(ticketUrl(key));
  const dialog = panel(page, key);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function getTicket(page: Page, key: string) {
  const res = await page.request.get(`/api/tickets/${key}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { ticket: Record<string, unknown> }).ticket;
}

const hostile = [
  "Before <script>window.__pwned = 1</script> after",
  "[click me](javascript:window.__pwned=1)",
  '<img src=x onerror="window.__pwned=1">',
  '<iframe src="https://evil.example/frame"></iframe>',
  "![tracker](https://evil.example/pixel.png)",
  '<a href="javascript:window.__pwned=1">raw anchor</a>',
  "[safe](https://example.com/page)",
].join("\n\n");

/** What must hold for rendered, untrusted Markdown, wherever it appears. */
async function expectInert(page: Page, rendered: Locator) {
  // The script tag is text the reader can see, not markup.
  await expect(rendered).toContainText("<script>window.__pwned = 1</script>");
  await expect(rendered.locator("script, iframe, img, object, embed, form, style")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
    undefined,
  );

  // A javascript: link keeps its words but is not a link.
  await expect(rendered.getByText("click me")).toBeVisible();
  await expect(rendered.getByRole("link", { name: "click me" })).toHaveCount(0);
  await expect(rendered.getByRole("link", { name: "raw anchor" })).toHaveCount(0);
  await expect(rendered.locator('a[href^="javascript"]')).toHaveCount(0);

  // A real link opens a new tab and gives the page nothing to hold on to.
  const safe = rendered.getByRole("link", { name: "safe" });
  await expect(safe).toHaveAttribute("href", "https://example.com/page");
  await expect(safe).toHaveAttribute("target", "_blank");
  expect((await safe.getAttribute("rel"))?.split(" ").sort()).toEqual(["noopener", "noreferrer"]);

  // An image is never loaded: it is a link to the image.
  const tracker = rendered.getByRole("link", { name: "tracker (image)" });
  await expect(tracker).toHaveAttribute("href", "https://evil.example/pixel.png");
  await expect(tracker).toHaveAttribute("rel", /noopener/);
}

test.describe("panel and URL", () => {
  test("opens over the board at a URL with the Ticket Key, and closes back to the board", async ({
    page,
  }) => {
    await setUp(page);
    await createTicket(page, {
      projectKey: "PLAT",
      title: "Fix rounding",
      description: "Totals round **down**.\n\n- first\n- second",
    });
    await page.goto(boardUrl);

    await page.getByRole("article", { name: "Fix rounding" }).click();

    await expect(page).toHaveURL(/\/acme-robotics\/projects\/PLAT\/tickets\/PLAT-1$/);
    const dialog = panel(page, "PLAT-1");
    await expect(dialog.getByRole("heading", { name: "Fix rounding" })).toBeVisible();
    await expect(dialog.getByText("PLAT-1", { exact: true })).toBeVisible();
    await expect(dialog.locator("strong")).toHaveText("down");
    await expect(dialog.getByRole("listitem").filter({ hasText: "first" })).toBeVisible();

    // The board stays mounted behind the panel.
    await expect(page.locator('[data-testid="board-scroller"]')).toBeAttached();

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page).toHaveURL(new RegExp(`${boardUrl}$`));
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("article", { name: "Fix rounding" })).toBeVisible();
  });

  test("reopens from a shared URL after a reload, and Escape closes it", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Share me" });
    const dialog = await openTicket(page, "PLAT-1");

    await page.reload();
    await expect(dialog.getByRole("heading", { name: "Share me" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`${boardUrl}$`));
    await expect(dialog).toBeHidden();
  });

  test("takes a Ticket Key in any letter case and shows it canonically", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Shouted" });

    await page.goto(ticketUrl("plat-1"));

    await expect(page).toHaveURL(new RegExp(`${ticketUrl("PLAT-1")}$`));
    await expect(panel(page, "PLAT-1")).toBeVisible();
  });

  test("says so for a Ticket that is missing or belongs to another Project", async ({ page }) => {
    await setUp(page);
    await createProject(page, { name: "Other", key: "OTHR" });
    await createTicket(page, { projectKey: "OTHR", title: "Elsewhere" });

    for (const key of ["PLAT-99", "OTHR-1"]) {
      await page.goto(ticketUrl(key));
      await expect(page.getByRole("dialog", { name: "Ticket not found" })).toBeVisible();
    }
    await page.getByRole("link", { name: "Back to the board" }).click();
    await expect(page).toHaveURL(new RegExp(`${boardUrl}$`));
  });
});

test.describe("Markdown safety", () => {
  test("shows a script tag in a description as plain text (flow 7)", async ({ page }) => {
    await setUp(page);
    await createTicket(page, {
      projectKey: "PLAT",
      title: "Scripted",
      description: "Hello <script>alert('pwned')</script> world",
    });
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });

    const dialog = await openTicket(page, "PLAT-1");

    await expect(dialog).toContainText("Hello <script>alert('pwned')</script> world");
    await expect(dialog.getByTestId("markdown").locator("script")).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test("keeps hostile Markdown inert in descriptions, Comments, and the preview", async ({
    page,
  }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Hostile", description: hostile });
    await addComment(page, "PLAT-1", hostile);
    const requested: string[] = [];
    page.on("request", (req) => requested.push(req.url()));

    const dialog = await openTicket(page, "PLAT-1");
    await expect(timeline(dialog).getByTestId("markdown")).toBeVisible();

    await expectInert(page, dialog.getByRole("region", { name: "Description" }));
    await expectInert(page, timeline(dialog).getByTestId("markdown"));

    // The composer's preview renders with the same rules.
    await dialog.getByRole("textbox", { name: "Comment" }).fill(hostile);
    await dialog.getByRole("tab", { name: "Preview" }).click();
    await expectInert(page, dialog.getByTestId("markdown-preview"));

    expect(requested.filter((url) => url.includes("evil.example"))).toEqual([]);
  });
});

test.describe("editing", () => {
  test("edits the title and the description, with a preview", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Old title", description: "old" });
    const dialog = await openTicket(page, "PLAT-1");

    await dialog.getByRole("button", { name: "Edit title" }).click();
    await dialog.getByRole("textbox", { name: "Title" }).fill("New title");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("heading", { name: "New title" })).toBeVisible();

    await dialog.getByRole("button", { name: "Edit description" }).click();
    await dialog.getByRole("textbox", { name: "Description" }).fill("Now with **weight**");
    const description = dialog.getByRole("region", { name: "Description" });
    await description.getByRole("tab", { name: "Preview" }).click();
    await expect(description.getByTestId("markdown-preview").locator("strong")).toHaveText(
      "weight",
    );
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
    await expect(dialog.getByRole("region", { name: "Description" }).locator("strong")).toHaveText(
      "weight",
    );
    expect(await getTicket(page, "PLAT-1")).toMatchObject({
      title: "New title",
      description: "Now with **weight**",
    });
  });

  test("asks for a title, and Escape cancels an edit without closing the panel", async ({
    page,
  }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Keep me" });
    const dialog = await openTicket(page, "PLAT-1");

    await dialog.getByRole("button", { name: "Edit title" }).click();
    await dialog.getByRole("textbox", { name: "Title" }).fill("");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Enter a title.");

    await dialog.getByRole("textbox", { name: "Title" }).press("Escape");
    await expect(dialog.getByRole("heading", { name: "Keep me" })).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("edits status, priority, type, parent, and assignee, and the board follows", async ({
    page,
  }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Checkout", type: "epic" });
    await createTicket(page, { projectKey: "PLAT", title: "Fix rounding" });
    const agent = await createAgent(page, "Rounder");
    const dialog = await openTicket(page, "PLAT-2");

    await dialog.getByLabel("Status").selectOption({ label: "In Progress" });
    await expect(dialog.getByLabel("Status")).toHaveValue("in_progress");
    await dialog.getByLabel("Priority").selectOption({ label: "Urgent" });
    await dialog.getByLabel("Type").selectOption({ label: "Bug" });
    await dialog.getByLabel("Parent").selectOption({ label: "PLAT-1 Checkout" });
    await dialog.getByLabel("Assignee").selectOption({ label: "Rounder" });

    await expect(timeline(dialog).getByText("assigned this to Rounder")).toBeVisible();
    expect(await getTicket(page, "PLAT-2")).toMatchObject({
      status: "in_progress",
      priority: "urgent",
      type: "bug",
      parent: { key: "PLAT-1" },
      assignee: { type: "agent", id: agent.id },
    });

    await dialog.getByLabel("Assignee").selectOption({ label: "Unassigned" });
    await dialog.getByLabel("Parent").selectOption({ label: "No parent" });
    await expect(timeline(dialog).getByText("unassigned this")).toBeVisible();
    expect(await getTicket(page, "PLAT-2")).toMatchObject({ assignee: null, parent: null });

    // The board behind the panel shows the change once it is closed.
    await dialog.getByRole("button", { name: "Close" }).click();
    const lane = page.getByRole("region", { name: "In Progress" });
    const ticket = lane.getByRole("article", { name: "Fix rounding" });
    await expect(ticket).toBeVisible();
    await expect(ticket.getByText("Urgent", { exact: true })).toBeVisible();
  });

  test("shows the server's refusal and puts the field back", async ({ page }) => {
    await setUp(page);
    const epic = await createTicket(page, { projectKey: "PLAT", title: "Checkout", type: "epic" });
    await createTicket(page, { projectKey: "PLAT", title: "Child", parentKey: epic.key });
    const dialog = await openTicket(page, "PLAT-2");

    // A Task under an Epic cannot become an Epic.
    await dialog.getByLabel("Type").selectOption({ label: "Epic" });

    await expect(dialog.getByRole("alert").first()).toBeVisible();
    await expect(dialog.getByLabel("Type")).toHaveValue("task");
    expect((await getTicket(page, "PLAT-2")).type).toBe("task");
  });
});

test.describe("children", () => {
  test("lists the children with their Status, and each opens its own panel", async ({ page }) => {
    await setUp(page);
    const epic = await createTicket(page, { projectKey: "PLAT", title: "Checkout", type: "epic" });
    const first = await createTicket(page, {
      projectKey: "PLAT",
      title: "Pay by card",
      type: "story",
      parentKey: epic.key,
    });
    await createTicket(page, { projectKey: "PLAT", title: "Pay by invoice", parentKey: epic.key });
    await moveTicket(page, first.key, "review");
    const dialog = await openTicket(page, "PLAT-1");

    const children = dialog.getByRole("region", { name: /Children/ });
    await expect(children.getByRole("heading", { name: "Children (2)" })).toBeVisible();
    const row = children.getByRole("link", { name: /Pay by card/ });
    await expect(row).toContainText("PLAT-2");
    await expect(row).toContainText("Review");
    await expect(children.getByRole("link", { name: /Pay by invoice/ })).toContainText("Backlog");

    await row.click();

    await expect(page).toHaveURL(new RegExp(`${ticketUrl("PLAT-2")}$`));
    await expect(panel(page, "PLAT-2").getByRole("heading", { name: "Pay by card" })).toBeVisible();
  });
});

test.describe("timeline and comments", () => {
  test("adds a Comment with a preview and shows it in the Timeline (flow 4)", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Discuss" });
    const dialog = await openTicket(page, "PLAT-1");

    const composer = dialog.getByRole("textbox", { name: "Comment" });
    await composer.fill("Looks **good**, ship it");
    await dialog.getByRole("tab", { name: "Preview" }).click();
    await expect(dialog.getByTestId("markdown-preview").locator("strong")).toHaveText("good");
    await dialog.getByRole("tab", { name: "Write" }).click();
    await dialog.getByRole("button", { name: "Add comment" }).click();

    const entry = timeline(dialog).locator('li[data-kind="comment"]');
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText("Ada");
    await expect(entry.locator("strong")).toHaveText("good");
    await expect(composer).toHaveValue("");

    await page.reload();
    await expect(timeline(dialog).locator('li[data-kind="comment"]')).toContainText("ship it");
  });

  test("won't add an empty Comment", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Quiet" });
    const dialog = await openTicket(page, "PLAT-1");

    await expect(dialog.getByRole("button", { name: "Add comment" })).toBeDisabled();
    await dialog.getByRole("textbox", { name: "Comment" }).fill("   ");
    await expect(dialog.getByRole("button", { name: "Add comment" })).toBeDisabled();
  });

  test("merges Comments and Activity in time order, with Agents marked", async ({ page }) => {
    await setUp(page);
    const agent = await createAgent(page, "Claude-1");
    const apiKey = await createApiKey(page, agent.id);
    await createTicket(page, { projectKey: "PLAT", title: "Busy" });
    const asAgent = await actAsAgent(apiKey);

    await moveTicket(page, "PLAT-1", "todo");
    await addComment(page, "PLAT-1", "Human first");
    expect((await asAgent.post("/api/tickets/PLAT-1/claim")).status()).toBe(200);
    expect(
      (
        await asAgent.post("/api/tickets/PLAT-1/comments", { data: { body: "Agent here" } })
      ).status(),
    ).toBe(201);
    await asAgent.dispose();
    const dialog = await openTicket(page, "PLAT-1");

    const items = timeline(dialog).getByRole("listitem");
    await expect(items).toHaveCount(5);
    const texts = (await items.allInnerTexts()).map((text) => text.replace(/\s+/g, " "));
    expect(texts[0]).toContain("Ada created this ticket");
    expect(texts[1]).toContain("Ada moved this from Backlog to To Do");
    expect(texts[2]).toContain("Human first");
    expect(texts[3]).toContain("Claude-1 claimed this ticket");
    expect(texts[4]).toContain("Agent here");

    // Agents carry the bot icon and a label. Users do not.
    const agentComment = items.nth(4);
    await expect(agentComment.getByRole("img", { name: "Agent" })).toBeVisible();
    await expect(agentComment).toContainText("Agent");
    await expect(items.nth(2).getByRole("img", { name: "Agent" })).toHaveCount(0);
    await expect(items.nth(3).getByRole("img", { name: "Agent" })).toBeVisible();
  });
});

test.describe("lifecycle", () => {
  test("claims a Ticket for the signed-in User", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Mine now" });
    const dialog = await openTicket(page, "PLAT-1");

    await dialog.getByRole("button", { name: "Claim" }).click();

    await expect(dialog.getByLabel("Status")).toHaveValue("in_progress");
    await expect(dialog.getByLabel("Assignee")).toHaveValue(/^user:/);
    await expect(dialog.getByRole("button", { name: "Claim" })).toHaveCount(0);
    expect(await getTicket(page, "PLAT-1")).toMatchObject({
      status: "in_progress",
      assignee: { name: "Ada" },
    });
  });

  test("offers no Claim on a Ticket someone holds", async ({ page }) => {
    await setUp(page);
    const agent = await createAgent(page, "Holder");
    await createTicket(page, { projectKey: "PLAT", title: "Taken" });
    await assignTicket(page, "PLAT-1", { type: "agent", id: agent.id });
    const dialog = await openTicket(page, "PLAT-1");

    await expect(dialog.getByLabel("Assignee")).toHaveValue(`agent:${agent.id}`);
    await expect(dialog.getByRole("button", { name: "Claim" })).toHaveCount(0);
  });

  test("archives and restores a Ticket", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Shelved" });
    const dialog = await openTicket(page, "PLAT-1");

    await dialog.getByRole("button", { name: "Archive" }).click();

    await expect(dialog.getByText("Archived", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Restore" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Archive" })).toHaveCount(0);
    await expect(dialog.getByLabel("Status")).toBeDisabled();
    await expect(dialog.getByLabel("Assignee")).toBeDisabled();
    await expect(timeline(dialog).getByText("archived this ticket")).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("article")).toHaveCount(0);

    await page.goto(ticketUrl("PLAT-1"));
    await panel(page, "PLAT-1").getByRole("button", { name: "Restore" }).click();
    await expect(panel(page, "PLAT-1").getByText("Archived", { exact: true })).toHaveCount(0);
    await panel(page, "PLAT-1").getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("article", { name: "Shelved" })).toBeVisible();
    expect((await getTicket(page, "PLAT-1")).archivedAt).toBeNull();
  });

  test("deletes a Ticket after confirmation (owner)", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Doomed" });
    const dialog = await openTicket(page, "PLAT-1");

    await dialog.getByRole("button", { name: "Delete" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete PLAT-1?" });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
    expect((await page.request.get("/api/tickets/PLAT-1")).status()).toBe(200);

    await dialog.getByRole("button", { name: "Delete" }).click();
    await page
      .getByRole("dialog", { name: "Delete PLAT-1?" })
      .getByRole("button", { name: "Delete ticket" })
      .click();

    await expect(page).toHaveURL(new RegExp(`${boardUrl}$`));
    await expect(page.getByRole("article")).toHaveCount(0);
    expect((await page.request.get("/api/tickets/PLAT-1")).status()).toBe(404);
  });

  test("gives a plain member Claim, Archive, and Restore but not Delete", async ({
    page,
    browser,
  }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Shared work" });
    const grace = await joinCompany(page, browser, {
      name: "Grace",
      email: "grace@example.com",
      role: "member",
    });

    await grace.goto(ticketUrl("PLAT-1"));
    const dialog = panel(grace, "PLAT-1");
    await expect(dialog.getByRole("button", { name: "Claim" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Archive" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Delete" })).toHaveCount(0);

    await dialog.getByRole("button", { name: "Archive" }).click();
    await expect(dialog.getByRole("button", { name: "Restore" })).toBeVisible();
    await dialog.getByRole("button", { name: "Restore" }).click();
    await expect(dialog.getByRole("button", { name: "Archive" })).toBeVisible();
    await grace.context().close();
  });

  test("gives an admin Delete", async ({ page, browser }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Admin's call" });
    const grace = await joinCompany(page, browser, {
      name: "Grace",
      email: "grace@example.com",
      role: "admin",
    });

    await grace.goto(ticketUrl("PLAT-1"));

    await expect(panel(grace, "PLAT-1").getByRole("button", { name: "Delete" })).toBeVisible();
    await grace.context().close();
  });
});

test.describe("small screens and themes", () => {
  test("fits the screen with long, wide content and keeps 44px touch targets on a phone", async ({
    page,
  }) => {
    await setUp(page);
    const agent = await createAgent(page, "Claude-Code-Agent-With-A-Very-Long-Name");
    const longWord = "Supercalifragilisticexpialidocious".repeat(4);
    const description = [
      `A very long unbroken word: ${longWord}`,
      "```\nconst veryLongLine = 'a'.repeat(400); console.log(veryLongLine, veryLongLine, veryLongLine);\n```",
      "| a | b | c | d | e | f |\n|---|---|---|---|---|---|\n| one | two | three | four | five | six seven eight nine ten |",
      `[a very long link](https://example.com/${"path/".repeat(40)})`,
    ].join("\n\n");
    await createTicket(page, {
      projectKey: "PLAT",
      title: `${"Reconcile the nightly settlement export ".repeat(4)}${"x".repeat(40)}`.slice(
        0,
        200,
      ),
      description,
    });
    await assignTicket(page, "PLAT-1", { type: "agent", id: agent.id });
    await addComment(page, "PLAT-1", `Comment ${longWord} with a very long word`);
    const dialog = await openTicket(page, "PLAT-1");
    await expect(timeline(dialog).locator('li[data-kind="comment"]')).toBeVisible();

    expect(await scrollsSideways(page)).toBe(false);
    // Measure once the panel has finished sliding in.
    await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0);
    // Nothing inside the panel is wider than the panel, so nothing scrolls sideways.
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
      // A phone gets the whole screen.
      expect(box?.width).toBe(viewport?.width);
      const targets = [
        dialog.getByRole("button", { name: "Close" }),
        dialog.getByRole("button", { name: "Edit title" }),
        dialog.getByRole("button", { name: "Archive" }),
        dialog.getByRole("button", { name: "Delete" }),
        dialog.getByRole("button", { name: "Edit description" }),
        dialog.getByLabel("Status"),
        dialog.getByLabel("Priority"),
        dialog.getByLabel("Type"),
        dialog.getByLabel("Assignee"),
        dialog.getByLabel("Parent"),
        dialog.getByRole("tab", { name: "Write" }),
        dialog.getByRole("tab", { name: "Preview" }),
        dialog.getByRole("button", { name: "Add comment" }),
      ];
      for (const target of targets) {
        await target.scrollIntoViewIfNeeded();
        const targetBox = await target.boundingBox();
        expect(
          targetBox?.height,
          await target.evaluate((el) => el.outerHTML.slice(0, 80)),
        ).toBeGreaterThanOrEqual(44);
        expect(targetBox?.width).toBeGreaterThanOrEqual(44);
      }
    } else {
      // A desktop gets a side panel with the board still visible beside it.
      expect(box?.width).toBeLessThan((viewport?.width ?? 0) - 200);
    }
  });

  test("is readable in light and dark", async ({ page }) => {
    await setUp(page);
    await createTicket(page, { projectKey: "PLAT", title: "Themed" });
    await addComment(page, "PLAT-1", "A comment");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const dialog = await openTicket(page, "PLAT-1");
      await expect(timeline(dialog).locator('li[data-kind="comment"]')).toBeVisible();

      const color = (el: Locator, prop: "backgroundColor" | "color") =>
        el.evaluate((node, p) => getComputedStyle(node)[p], prop);
      const panelBg = await color(dialog, "backgroundColor");
      const commentBg = await color(
        timeline(dialog).locator('li[data-kind="comment"]'),
        "backgroundColor",
      );
      expect(commentBg).not.toBe(panelBg);
      expect(await color(dialog.getByRole("heading", { name: "Themed" }), "color")).not.toBe(
        panelBg,
      );
      const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
      expect(isDark).toBe(scheme === "dark");
    }
  });
});
