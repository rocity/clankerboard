import { expect, type Page, test } from "@playwright/test";
import { expireInvites, resetDatabase } from "./database";
import { createCompany, inviteByApi, joinByApi, scrollsSideways, signUp } from "./helpers";

test.beforeEach(resetDatabase);

// Runs at 1280px in light and at 375px in dark (see playwright.config.ts).
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const onPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

const row = (page: Page, text: string) => page.getByRole("listitem").filter({ hasText: text });

type Member = { userId: string; email: string; role: string };
async function memberRoles(page: Page) {
  const res = await page.request.get("/api/members");
  const { members } = (await res.json()) as { members: Member[] };
  return Object.fromEntries(members.map((m) => [m.email, m.role]));
}

/** Ada owns Acme Robotics. Bob is a member and Cy an admin, both signed in in their own contexts. */
async function seedCompany({
  page,
  browser,
}: {
  page: Page;
  browser: Parameters<typeof joinByApi>[0];
}) {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  const bob = await joinByApi(browser, page, (await inviteByApi(page, "bob@example.com")).link, {
    name: "Bob",
    email: "bob@example.com",
  });
  const cy = await joinByApi(
    browser,
    page,
    (await inviteByApi(page, "cy@example.com", { role: "admin" })).link,
    { name: "Cy", email: "cy@example.com" },
  );
  return { bob, cy };
}

test("an owner reaches the members page from the navigation and sees everyone with their Role", async ({
  page,
  browser,
}) => {
  const { bob, cy } = await seedCompany({ page, browser });
  await page.goto("/acme-robotics");

  await page.getByRole("link", { name: "Members" }).click();

  await expect(page).toHaveURL("/acme-robotics/members");
  await expect(page.getByRole("heading", { name: "Members", level: 1 })).toBeVisible();
  await expect(row(page, "ada@example.com")).toContainText("You");
  await expect(row(page, "ada@example.com")).toContainText("Owner");
  await expect(row(page, "bob@example.com").getByLabel("Role for Bob")).toHaveValue("member");
  await expect(row(page, "cy@example.com").getByLabel("Role for Cy")).toHaveValue("admin");
  expect(await scrollsSideways(page)).toBe(false);

  await bob.context.close();
  await cy.context.close();
});

test("an owner changes a Role and removes a User", async ({ page, browser }) => {
  const { bob, cy } = await seedCompany({ page, browser });
  await page.goto("/acme-robotics/members");

  await row(page, "bob@example.com").getByLabel("Role for Bob").selectOption("admin");

  await expect(row(page, "bob@example.com").getByLabel("Role for Bob")).toHaveValue("admin");
  await expect.poll(() => memberRoles(page)).toMatchObject({ "bob@example.com": "admin" });

  const removeCy = page.getByRole("button", { name: "Remove Cy" });
  if (onPhone(page)) expect((await removeCy.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await removeCy.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Cy");
  await dialog.getByRole("button", { name: "Remove" }).click();

  await expect(row(page, "cy@example.com")).toHaveCount(0);
  expect(await memberRoles(page)).not.toHaveProperty(["cy@example.com"]);

  await bob.context.close();
  await cy.context.close();
});

test("a failed Role change shows the server's message and keeps the old Role", async ({
  page,
  browser,
}) => {
  const { bob, cy } = await seedCompany({ page, browser });
  await page.route("**/api/members/*", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "A company needs at least one owner." }),
        })
      : route.continue(),
  );
  await page.goto("/acme-robotics/members");

  await row(page, "bob@example.com").getByLabel("Role for Bob").selectOption("admin");

  await expect(page.getByRole("alert")).toHaveText("A company needs at least one owner.");
  await expect(row(page, "bob@example.com").getByLabel("Role for Bob")).toHaveValue("member");

  await bob.context.close();
  await cy.context.close();
});

test("an admin cannot change or remove an owner, or hand out the owner Role", async ({
  page,
  browser,
}) => {
  const { bob, cy } = await seedCompany({ page, browser });
  await cy.page.goto("/acme-robotics/members");

  await expect(row(cy.page, "ada@example.com")).toContainText("Owner");
  await expect(row(cy.page, "ada@example.com").getByRole("combobox")).toHaveCount(0);
  await expect(cy.page.getByRole("button", { name: "Remove Ada" })).toHaveCount(0);
  const bobRole = row(cy.page, "bob@example.com").getByLabel("Role for Bob");
  await expect(bobRole.locator("option")).toHaveText(["Admin", "Member"]);
  await expect(cy.page.getByRole("button", { name: "Remove Bob" })).toBeVisible();
  await expect(cy.page.getByLabel("Role", { exact: true })).toBeVisible();
  await expect(cy.page.getByLabel("Role", { exact: true }).locator("option")).toHaveText([
    "Admin",
    "Member",
  ]);

  await bob.context.close();
  await cy.context.close();
});

test("a plain member sees the list without any controls", async ({ page, browser }) => {
  const { bob, cy } = await seedCompany({ page, browser });
  await bob.page.goto("/acme-robotics/members");

  await expect(row(bob.page, "cy@example.com")).toContainText("Admin");
  await expect(row(bob.page, "ada@example.com")).toContainText("Owner");
  await expect(bob.page.getByRole("combobox")).toHaveCount(0);
  await expect(bob.page.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
  await expect(bob.page.getByRole("button", { name: "Create invite" })).toHaveCount(0);
  await expect(bob.page.getByRole("heading", { name: "Pending invites" })).toHaveCount(0);

  await bob.context.close();
  await cy.context.close();
});

test("the Invite form hands over a copyable link, and the Invite is pending", async ({ page }) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await page.goto("/acme-robotics/members");

  await page.getByLabel("Email").fill("linus@example.com");
  await page.getByLabel("Role", { exact: true }).selectOption("admin");
  const create = page.getByRole("button", { name: "Create invite" });
  if (onPhone(page)) expect((await create.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await create.click();

  const link = page.getByLabel("Invite link");
  await expect(link).toHaveValue(/\/invite#.+/);
  const copy = page.getByRole("button", { name: "Copy link" });
  if (onPhone(page)) expect((await copy.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await copy.click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await link.inputValue());

  const pending = row(page, "linus@example.com");
  await expect(pending).toContainText("Admin");
  await expect(pending).toContainText("Expires");
  expect(await scrollsSideways(page)).toBe(false);
});

test("an Invite for an address that already has a pending Invite says so", async ({ page }) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await inviteByApi(page, "linus@example.com");
  await page.goto("/acme-robotics/members");

  await page.getByLabel("Email").fill("linus@example.com");
  await page.getByRole("button", { name: "Create invite" }).click();

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Invite link")).toHaveCount(0);
});

test("a pending Invite can be resent, which kills the old link, and then revoked", async ({
  page,
}) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  const { link: oldLink } = await inviteByApi(page, "linus@example.com");
  await page.goto("/acme-robotics/members");
  const lookup = async (link: string) =>
    (
      await page.request.post("/api/invite-links/lookup", {
        data: { token: link.split("#")[1] },
      })
    ).status();
  expect(await lookup(oldLink)).toBe(200);

  const pending = row(page, "linus@example.com");
  const resend = pending.getByRole("button", { name: "Resend" });
  if (onPhone(page)) expect((await resend.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await resend.click();

  const newLink = await page.getByLabel("Invite link").inputValue();
  expect(newLink).not.toBe(oldLink);
  expect(await lookup(oldLink)).not.toBe(200);
  expect(await lookup(newLink)).toBe(200);

  await pending.getByRole("button", { name: "Revoke" }).click();

  await expect(row(page, "linus@example.com")).toHaveCount(0);
  expect(await lookup(newLink)).toBe(410);
});

test("an expired Invite is marked and can be resent", async ({ page }) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await inviteByApi(page, "linus@example.com");
  await expireInvites();
  await page.goto("/acme-robotics/members");

  const pending = row(page, "linus@example.com");
  await expect(pending).toContainText("Expired");

  await pending.getByRole("button", { name: "Resend" }).click();

  await expect(page.getByLabel("Invite link")).toHaveValue(/\/invite#.+/);
  await expect(pending).toContainText("Expires");
  await expect(pending).not.toContainText("Expired");
});

test("an admin cannot resend or revoke an Invite for the owner Role", async ({ page, browser }) => {
  const { bob, cy } = await seedCompany({ page, browser });
  await inviteByApi(page, "dee@example.com", { role: "owner" });
  await inviteByApi(page, "eli@example.com", { role: "member" });
  await cy.page.goto("/acme-robotics/members");

  await expect(
    row(cy.page, "eli@example.com").getByRole("button", { name: "Revoke" }),
  ).toBeVisible();
  await expect(row(cy.page, "dee@example.com")).toContainText("Owner");
  await expect(row(cy.page, "dee@example.com").getByRole("button")).toHaveCount(0);

  await bob.context.close();
  await cy.context.close();
});

test("the members page works in the dark theme with a long name and email", async ({
  page,
  browser,
}) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  const longName = "Bartholomew Maximilian Featherstonehaugh-Cholmondeley";
  const longEmail =
    "bartholomew.maximilian.featherstonehaugh.cholmondeley@a-very-long-domain.example.com";
  const joined = await joinByApi(browser, page, (await inviteByApi(page, longEmail)).link, {
    name: longName,
    email: longEmail,
  });
  await inviteByApi(page, longEmail.replace("bartholomew", "pending"));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/acme-robotics/members");

  await expect(row(page, longEmail)).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);

  await joined.context.close();
});
