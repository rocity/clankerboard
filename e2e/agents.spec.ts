import { expect, type Page, test } from "@playwright/test";
import { resetDatabase } from "./database";
import { createCompany, joinCompany, scrollsSideways, signUp } from "./helpers";

test.beforeEach(resetDatabase);

type KeyBody = { key: { id: string }; secret: string };

/** Creates an Agent and a key over HTTP as the signed-in User. */
async function seedAgent(page: Page, name: string, label = "laptop") {
  const agent = await page.request.post("/api/agents", { data: { name } });
  expect(agent.status()).toBe(201);
  const { agent: created } = (await agent.json()) as { agent: { id: string } };
  const key = await page.request.post(`/api/agents/${created.id}/keys`, { data: { label } });
  expect(key.status()).toBe(201);
  return { id: created.id, ...((await key.json()) as KeyBody) };
}

function agentCard(page: Page, name: string) {
  return page.getByRole("article", { name });
}

test("a member creates, renames, and revokes an Agent", async ({ page }) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await page.goto("/acme-robotics/agents");
  await expect(page.getByRole("heading", { name: "Agents", level: 1 })).toBeVisible();
  await expect(page.getByText("No agents yet.")).toBeVisible();

  await page.getByRole("button", { name: "New agent" }).click();
  await page.getByLabel("Name").fill("Claude-1");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(agentCard(page, "Claude-1")).toBeVisible();
  await expect(agentCard(page, "Claude-1").getByText("Owned by you")).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);

  await agentCard(page, "Claude-1").getByRole("button", { name: "Agent actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(agentCard(page, "Planner")).toBeVisible();
  await expect(agentCard(page, "Claude-1")).toHaveCount(0);

  await agentCard(page, "Planner").getByRole("button", { name: "Agent actions" }).click();
  await page.getByRole("menuitem", { name: "Revoke" }).click();
  await expect(page.getByRole("heading", { name: "Revoke Planner?" })).toBeVisible();
  await page.getByRole("button", { name: "Revoke agent" }).click();

  // A revoked Agent stays in the list, marked, with no way to create keys.
  const revoked = agentCard(page, "Planner");
  await expect(revoked.getByText("Revoked", { exact: true })).toBeVisible();
  await expect(revoked.getByRole("button", { name: "Create key" })).toHaveCount(0);
  expect(await scrollsSideways(page)).toBe(false);
});

test("a name already in use is refused with the server's message", async ({ page }) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await seedAgent(page, "Claude-1");
  await page.goto("/acme-robotics/agents");

  await page.getByRole("button", { name: "New agent" }).click();
  await page.getByLabel("Name").fill("claude-1");
  await page.getByRole("button", { name: "Create agent" }).click();

  await expect(page.getByRole("alert")).toHaveText("An agent with that name already exists.");
});

test("a new key is shown once, with setup snippets for this server", async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  const agent = await page.request.post("/api/agents", { data: { name: "Claude-1" } });
  expect(agent.status()).toBe(201);
  await page.goto("/acme-robotics/agents");

  await agentCard(page, "Claude-1").getByRole("button", { name: "Create key" }).click();
  await page.getByLabel("Label").fill("laptop");
  await page.getByRole("button", { name: "Create key" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Copy your key now" })).toBeVisible();
  const apiKey = await dialog.getByLabel("API key").inputValue();
  expect(apiKey).toMatch(/^cb_[A-Za-z0-9_-]{32,}$/);
  expect(await scrollsSideways(page)).toBe(false);

  await dialog.getByRole("button", { name: "Copy key" }).click();
  await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(apiKey);

  // The command is ready to paste, with this server's URL and the key.
  const command = dialog.getByRole("tabpanel");
  await expect(command).toContainText(
    `claude mcp add --scope user --transport http agentkanban ${baseURL}/mcp --header "Authorization: Bearer ${apiKey}"`,
  );
  await dialog.getByRole("button", { name: "Copy command" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`${baseURL}/mcp`);

  // The .mcp.json snippet names an env var and never holds the key.
  await dialog.getByRole("tab", { name: ".mcp.json" }).click();
  const snippet = dialog.getByRole("tabpanel");
  await expect(snippet).toContainText(`"url": "${baseURL}/mcp"`);
  await expect(snippet).toContainText(`"Authorization": "Bearer \${AGENTKANBAN_API_KEY}"`);
  await expect(snippet).toContainText(`export AGENTKANBAN_API_KEY=${apiKey}`);
  expect(await snippet.locator("pre").first().textContent()).not.toContain(apiKey);

  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);

  // The key never comes back: not after closing, not after a reload.
  const card = agentCard(page, "Claude-1");
  await expect(card.getByText("laptop")).toBeVisible();
  await expect(card.getByText(apiKey.slice(0, 11))).toBeVisible();
  await expect(page.locator("body")).not.toContainText(apiKey);
  await page.reload();
  await expect(agentCard(page, "Claude-1").getByText(apiKey.slice(0, 11))).toBeVisible();
  await expect(page.locator("body")).not.toContainText(apiKey);
});

test("a key on screen survives an outside click and Escape, and only Done closes it", async ({
  page,
}) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  const agent = await page.request.post("/api/agents", { data: { name: "Claude-1" } });
  expect(agent.status()).toBe(201);
  await page.goto("/acme-robotics/agents");

  await agentCard(page, "Claude-1").getByRole("button", { name: "Create key" }).click();

  // Before the key exists, Escape still closes the form.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await agentCard(page, "Claude-1").getByRole("button", { name: "Create key" }).click();
  await page.getByLabel("Label").fill("laptop");
  await page.getByRole("button", { name: "Create key" }).click();
  const dialog = page.getByRole("dialog");
  const apiKey = await dialog.getByLabel("API key").inputValue();
  expect(apiKey).toMatch(/^cb_/);

  // A click on the backdrop and Escape both leave the key where it is.
  await page.mouse.click(2, 2);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("API key")).toHaveValue(apiKey);

  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
});

test("the key list shows label, prefix, and last-used time, and revokes a key", async ({
  page,
  request,
  baseURL,
}) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  const agent = await seedAgent(page, "Claude-1", "laptop");
  await page.goto("/acme-robotics/agents");

  const card = agentCard(page, "Claude-1");
  await expect(card.getByText("laptop")).toBeVisible();
  await expect(card.getByText(agent.secret.slice(0, 11))).toBeVisible();
  await expect(card.getByText("Never used").first()).toBeVisible();

  // Using the key shows up as a last-used time.
  const used = await request.get(`${baseURL}/api/whoami`, {
    headers: { authorization: `Bearer ${agent.secret}` },
  });
  expect(used.status()).toBe(200);
  await page.reload();
  await expect(agentCard(page, "Claude-1").getByText("Never used")).toHaveCount(0);
  await expect(agentCard(page, "Claude-1").getByText("Used just now")).toBeVisible();

  await agentCard(page, "Claude-1").getByRole("button", { name: "Revoke key laptop" }).click();
  await expect(page.getByRole("heading", { name: "Revoke key laptop?" })).toBeVisible();
  await page.getByRole("button", { name: "Revoke key" }).click();

  await expect(agentCard(page, "Claude-1").getByText("Revoked", { exact: true })).toBeVisible();
  const after = await request.get(`${baseURL}/api/whoami`, {
    headers: { authorization: `Bearer ${agent.secret}` },
  });
  expect(after.status()).toBe(401);
  expect(await scrollsSideways(page)).toBe(false);
});

test("a member sees only their Agents, and an admin sees everyone's and can revoke them", async ({
  page,
  browser,
}) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await seedAgent(page, "Ada-Agent");
  const bob = await joinCompany(page, browser, {
    name: "Bob",
    email: "bob.the.builder.with.a.very.long.email@example.com",
  });
  await seedAgent(bob, "Bob-Agent", "a-key-label-that-is-quite-long-indeed");

  await bob.goto("/acme-robotics/agents");
  await expect(agentCard(bob, "Bob-Agent")).toBeVisible();
  await expect(agentCard(bob, "Ada-Agent")).toHaveCount(0);

  await page.goto("/acme-robotics/agents");
  await expect(agentCard(page, "Ada-Agent").getByText("Owned by you")).toBeVisible();
  const others = agentCard(page, "Bob-Agent");
  await expect(others.getByText("Owned by Bob")).toBeVisible();
  await expect(
    others.getByText("bob.the.builder.with.a.very.long.email@example.com"),
  ).toBeVisible();
  // An admin cannot rename it or create keys for it, only revoke.
  await expect(others.getByRole("button", { name: "Create key" })).toHaveCount(0);
  await others.getByRole("button", { name: "Agent actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Rename" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Revoke" }).click();
  await page.getByRole("button", { name: "Revoke agent" }).click();
  await expect(others.getByText("Revoked", { exact: true }).first()).toBeVisible();

  // Bob sees his Agent revoked after a reload.
  await bob.reload();
  await expect(
    agentCard(bob, "Bob-Agent").getByText("Revoked", { exact: true }).first(),
  ).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await bob.context().close();
});

test("an admin sees every Agent with its owner, can revoke it, and cannot rename it", async ({
  page,
  browser,
}) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await seedAgent(page, "Ada-Agent");
  const cy = await joinCompany(page, browser, {
    name: "Cy",
    email: "cy@example.com",
    role: "admin",
  });

  await cy.goto("/acme-robotics/agents");
  const card = agentCard(cy, "Ada-Agent");
  await expect(card.getByText("Owned by Ada")).toBeVisible();
  await expect(card.getByRole("button", { name: "Create key" })).toHaveCount(0);
  await card.getByRole("button", { name: "Agent actions" }).click();
  await expect(cy.getByRole("menuitem", { name: "Rename" })).toHaveCount(0);
  await cy.getByRole("menuitem", { name: "Revoke" }).click();
  await cy.getByRole("button", { name: "Revoke agent" }).click();

  await expect(card.getByText("Revoked", { exact: true }).first()).toBeVisible();
  await cy.context().close();
});

test("the Agents page is reachable from the User menu", async ({ page }) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await page.goto("/acme-robotics");

  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: "Agents" }).click();

  await expect(page).toHaveURL("/acme-robotics/agents");
  await expect(page.getByRole("heading", { name: "Agents", level: 1 })).toBeVisible();
});
