import { expect, type Page, test } from "@playwright/test";
import { expireInvites, resetDatabase } from "./database";
import {
  createCompany,
  createProject,
  inviteByApi,
  joinByApi,
  password,
  scrollsSideways,
  signUp,
} from "./helpers";

test.beforeEach(resetDatabase);

// Runs at 1280px in light and at 375px in dark (see playwright.config.ts).
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function freshContext(
  browser: Parameters<typeof joinByApi>[0],
  like: Page,
  options: { clipboard?: boolean } = {},
) {
  const dark = await like.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const context = await browser.newContext({
    viewport: like.viewportSize(),
    colorScheme: dark ? "dark" : "light",
    permissions: options.clipboard ? ["clipboard-read", "clipboard-write"] : [],
  });
  return { context, page: await context.newPage() };
}

test("flow 2: invite by copied link, accept in a fresh browser, and land in the Company", async ({
  page,
  browser,
}) => {
  await signUp(page, "Grace", "grace@example.com");
  await createCompany(page, "Acme Robotics");
  await createProject(page, { name: "Platform", key: "PLAT" });

  // The owner invites from the members page and copies the link.
  await page.goto("/acme-robotics/members");
  await page.getByLabel("Email").fill("linus@example.com");
  await page.getByRole("button", { name: "Create invite" }).click();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain("/invite#");

  // Open sign-up is off here, so only the Invite lets this User in.
  const invitee = await freshContext(browser, page);
  await invitee.page.goto(link);
  await expect(invitee.page.getByRole("heading", { name: "Join Acme Robotics" })).toBeVisible();
  const summary = invitee.page.getByRole("region", { name: "Invite details" });
  await expect(summary).toContainText("Company");
  await expect(summary).toContainText("Acme Robotics");
  await expect(summary).toContainText("Role");
  await expect(summary).toContainText("Member");
  await expect(summary).toContainText("Grace");
  await expect(invitee.page.getByLabel("Email")).toHaveValue("linus@example.com");
  expect(await scrollsSideways(invitee.page)).toBe(false);
  await invitee.page.getByLabel("Name").fill("Linus");
  await invitee.page.getByLabel("Password").fill(password);
  await invitee.page.getByRole("button", { name: "Sign up" }).click();

  // The second User is in the Company, and sees what Grace sees.
  await expect(invitee.page).toHaveURL("/acme-robotics");
  await expect(invitee.page.getByRole("heading", { name: "Acme Robotics" })).toBeVisible();
  await expect(invitee.page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(
    invitee.page.getByRole("list", { name: "Projects" }).getByText("Platform"),
  ).toBeVisible();
  await invitee.page.getByRole("link", { name: "Members" }).click();
  await expect(
    invitee.page.getByRole("listitem").filter({ hasText: "grace@example.com" }),
  ).toBeVisible();

  // The Invite is no longer pending for Grace.
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "linus@example.com" })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Pending invites" })).toHaveCount(0);

  await invitee.context.close();
});

test("a Team Invite names the Team and the Role", async ({ page, browser }) => {
  await signUp(page, "Grace", "grace@example.com");
  await createCompany(page, "Acme Robotics");
  const teamRes = await page.request.post("/api/teams", { data: { name: "Platform" } });
  const { team } = (await teamRes.json()) as { team: { id: string } };
  const { link } = await inviteByApi(page, "linus@example.com", { teamId: team.id });
  await page.goto("/acme-robotics/members");
  await expect(page.getByRole("listitem").filter({ hasText: "linus@example.com" })).toContainText(
    "Platform",
  );

  const invitee = await freshContext(browser, page);
  await invitee.page.goto(link);

  const summary = invitee.page.getByRole("region", { name: "Invite details" });
  await expect(summary).toContainText("Platform");
  await expect(summary).toContainText("Acme Robotics");
  await expect(summary).toContainText("Member");
  await invitee.context.close();
});

test("opening a second Invite link in the same tab replaces the first", async ({
  page,
  browser,
}) => {
  await signUp(page, "Grace", "grace@example.com");
  await createCompany(page, "Acme Robotics");
  const { link: first } = await inviteByApi(page, "linus@example.com");
  const { link: second } = await inviteByApi(page, "ada@example.com", { role: "admin" });
  const visitor = await freshContext(browser, page);
  await visitor.page.goto(first);
  await expect(visitor.page.getByLabel("Email")).toHaveValue("linus@example.com");

  await visitor.page.goto(second);

  await expect(visitor.page.getByLabel("Email")).toHaveValue("ada@example.com");
  await expect(visitor.page.getByRole("region", { name: "Invite details" })).toContainText("Admin");
  await visitor.context.close();
});

test("an invitee who has signed up before signs in on the Invite page and joins", async ({
  page,
  browser,
}) => {
  await signUp(page, "Grace", "grace@example.com");
  await createCompany(page, "Acme Robotics");
  await joinByApi(browser, page, (await inviteByApi(page, "linus@example.com")).link, {
    name: "Linus",
    email: "linus@example.com",
  }).then((joined) => joined.context.close());
  await createCompany(page, "Globex");
  const { link } = await inviteByApi(page, "linus@example.com");

  const invitee = await freshContext(browser, page);
  await invitee.page.goto(link);
  await invitee.page.getByRole("button", { name: "I've signed up before" }).click();
  await invitee.page.getByLabel("Password").fill(password);
  await invitee.page.getByRole("button", { name: "Sign in" }).click();

  await expect(invitee.page).toHaveURL("/globex");
  await invitee.context.close();
});

test("OAuth from an Invite page never sends the Invite token to the auth server, and the page still knows the Invite on return", async ({
  page,
  browser,
}) => {
  await signUp(page, "Grace", "grace@example.com");
  await createCompany(page, "Acme Robotics");
  const { link } = await inviteByApi(page, "linus@example.com");
  const token = link.split("#")[1] ?? "";
  expect(token).not.toBe("");

  const invitee = await freshContext(browser, page);
  await invitee.page.route("**/api/auth-providers", (route) =>
    route.fulfill({ json: { providers: ["google"] } }),
  );
  let asked = "";
  // Better Auth sends the browser back to the callbackURL it was given.
  await invitee.page.route("**/api/auth/sign-in/social", (route) => {
    asked = route.request().postData() ?? "";
    const { callbackURL } = JSON.parse(asked) as { callbackURL: string };
    return route.fulfill({ json: { url: callbackURL, redirect: true } });
  });
  await invitee.page.goto(link);
  await invitee.page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(invitee.page).toHaveURL(/\/invite/);
  // The callback URL is stored by Better Auth and echoed in a redirect, so it must not hold the token.
  expect(asked).not.toContain(token);
  // The page found its Invite again from the cookie the server also reads for OAuth sign-up.
  await expect(invitee.page.getByRole("heading", { name: "Join Acme Robotics" })).toBeVisible();
  await expect(invitee.page.getByLabel("Email")).toHaveValue("linus@example.com");
  await invitee.context.close();
});

test("a signed-in invitee joins with one click, and the wrong User can sign out", async ({
  page,
  browser,
}) => {
  await signUp(page, "Grace", "grace@example.com");
  await createCompany(page, "Acme Robotics");
  const linus = await joinByApi(
    browser,
    page,
    (await inviteByApi(page, "linus@example.com")).link,
    {
      name: "Linus",
      email: "linus@example.com",
    },
  );
  const { link: forSomeoneElse } = await inviteByApi(page, "ada@example.com");
  await createCompany(page, "Globex");
  const { link: forLinus } = await inviteByApi(page, "linus@example.com");

  await linus.page.goto(forSomeoneElse);
  await expect(linus.page.getByText("linus@example.com")).toBeVisible();
  await linus.page.getByRole("button", { name: "Join Acme Robotics" }).click();
  await expect(linus.page.getByRole("alert")).toHaveText(
    "This invite is for a different email address.",
  );
  await linus.page.getByRole("button", { name: "Sign out" }).click();
  await expect(linus.page.getByLabel("Email")).toHaveValue("ada@example.com");

  await linus.page.goto(forLinus);
  await linus.page.getByRole("button", { name: "I've signed up before" }).click();
  await linus.page.getByLabel("Password").fill(password);
  await linus.page.getByRole("button", { name: "Sign in" }).click();
  await expect(linus.page).toHaveURL("/globex");
  await linus.context.close();
});

test.describe("a link that cannot be used", () => {
  async function openAs(page: Page, browser: Parameters<typeof joinByApi>[0], link: string) {
    const visitor = await freshContext(browser, page);
    await visitor.page.goto(link);
    return visitor;
  }

  test("a made-up link is not valid", async ({ page, browser }) => {
    const visitor = await openAs(page, browser, "/invite#not-a-real-token");
    await expect(
      visitor.page.getByRole("heading", { name: "This invite link is not valid." }),
    ).toBeVisible();
    await expect(visitor.page.getByLabel("Email")).toHaveCount(0);
    expect(await scrollsSideways(visitor.page)).toBe(false);
    await visitor.context.close();
  });

  test("a link with no token is not valid", async ({ page, browser }) => {
    const visitor = await openAs(page, browser, "/invite");
    await expect(
      visitor.page.getByRole("heading", { name: "This invite link is not valid." }),
    ).toBeVisible();
    await visitor.context.close();
  });

  test("a revoked Invite says it was revoked", async ({ page, browser }) => {
    await signUp(page, "Grace", "grace@example.com");
    await createCompany(page, "Acme Robotics");
    const { link } = await inviteByApi(page, "linus@example.com");
    await page.goto("/acme-robotics/members");
    await page.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(0);

    const visitor = await openAs(page, browser, link);

    await expect(
      visitor.page.getByRole("heading", { name: "This invite was revoked." }),
    ).toBeVisible();
    await expect(visitor.page.getByText("Ask whoever invited you for a new one.")).toBeVisible();
    await visitor.context.close();
  });

  test("an Invite that was already used says so", async ({ page, browser }) => {
    await signUp(page, "Grace", "grace@example.com");
    await createCompany(page, "Acme Robotics");
    const { link } = await inviteByApi(page, "linus@example.com");
    await joinByApi(browser, page, link, { name: "Linus", email: "linus@example.com" }).then(
      (joined) => joined.context.close(),
    );

    const visitor = await openAs(page, browser, link);

    await expect(
      visitor.page.getByRole("heading", { name: "This invite was already used." }),
    ).toBeVisible();
    await visitor.context.close();
  });

  test("an expired Invite says it expired", async ({ page, browser }) => {
    await signUp(page, "Grace", "grace@example.com");
    await createCompany(page, "Acme Robotics");
    const { link } = await inviteByApi(page, "linus@example.com");
    await expireInvites();

    const visitor = await openAs(page, browser, link);

    await expect(
      visitor.page.getByRole("heading", { name: "This invite has expired." }),
    ).toBeVisible();
    await visitor.context.close();
  });
});
