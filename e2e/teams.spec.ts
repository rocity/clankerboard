import { expect, type Locator, type Page, test } from "@playwright/test";
import { resetDatabase } from "./database";
import {
  addTeamMember,
  createCompany,
  createProject,
  createTeam,
  inviteByApi,
  joinByApi,
  scrollsSideways,
  signUp,
  teamMembers,
} from "./helpers";

test.beforeEach(resetDatabase);

// Runs at 1280px in light and at 375px in dark (see playwright.config.ts).
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

type Joined = Awaited<ReturnType<typeof joinByApi>>;
type Browser = Parameters<typeof joinByApi>[0];

/**
 * Ada owns Acme Robotics and the Platform Team. Cy is an admin. Lee is a plain member who
 * leads Platform, Bob is a plain member on it, and Eve is a plain member on no Team.
 */
async function seed({ page, browser }: { page: Page; browser: Browser }) {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  const join = async (name: string, role?: string) =>
    joinByApi(
      browser,
      page,
      (await inviteByApi(page, `${name.toLowerCase()}@example.com`, { role })).link,
      {
        name,
        email: `${name.toLowerCase()}@example.com`,
      },
    );
  const cy = await join("Cy", "admin");
  const lee = await join("Lee");
  const bob = await join("Bob");
  const eve = await join("Eve");
  const platform = await createTeam(page, "Platform");
  await addTeamMember(page, platform.id, "lee@example.com", "lead");
  await addTeamMember(page, platform.id, "bob@example.com");
  const design = await createTeam(page, "Design");
  await addTeamMember(page, design.id, "ada@example.com");
  const contexts: Joined[] = [cy, lee, bob, eve];
  return {
    cy,
    lee,
    bob,
    eve,
    platform,
    design,
    close: () => Promise.all(contexts.map((c) => c.context.close())),
  };
}

const teamCard = (page: Page, name: string) =>
  page.getByRole("list", { name: "Teams" }).getByRole("listitem").filter({ hasText: name });

test("the Teams list is reached from the navigation and shows each Team with its member count", async ({
  page,
  browser,
}) => {
  const { eve, close } = await seed({ page, browser });
  await page.goto("/acme-robotics");

  await page
    .getByRole("navigation", { name: "Company pages" })
    .getByRole("link", { name: "Teams" })
    .click();

  await expect(page).toHaveURL("/acme-robotics/teams");
  await expect(page.getByRole("heading", { name: "Teams", level: 1 })).toBeVisible();
  await expect(teamCard(page, "Platform")).toContainText("2 members");
  await expect(teamCard(page, "Design")).toContainText("1 member");
  expect(await scrollsSideways(page)).toBe(false);

  await eve.page.goto("/acme-robotics/teams");
  await expect(teamCard(eve.page, "Platform")).toContainText("2 members");
  await close();
});

const memberRow = (page: Page, text: string) =>
  page.getByRole("list", { name: "People" }).getByRole("listitem").filter({ hasText: text });

test("a Team page shows its members with who leads, and its Projects, to a plain member", async ({
  page,
  browser,
}) => {
  const { eve, platform, close } = await seed({ page, browser });
  await createProject(page, { name: "Core API", key: "CORE", teamId: platform.id });
  await createProject(page, { name: "Billing", key: "BILL", teamId: platform.id });
  await createProject(page, { name: "Brand site", key: "SITE" });

  await eve.page.goto("/acme-robotics/teams");
  await teamCard(eve.page, "Platform").click();

  await expect(eve.page).toHaveURL(`/acme-robotics/teams/${platform.id}`);
  await expect(eve.page.getByRole("heading", { name: "Platform", level: 1 })).toBeVisible();
  await expect(memberRow(eve.page, "Lee")).toContainText("Lead");
  await expect(memberRow(eve.page, "Lee")).toContainText("lee@example.com");
  await expect(memberRow(eve.page, "Bob")).not.toContainText("Lead");
  await expect(eve.page.getByRole("list", { name: "People" }).getByRole("listitem")).toHaveCount(2);
  const projects = eve.page.getByRole("list", { name: "Projects" });
  await expect(projects.getByRole("listitem")).toHaveCount(2);
  await expect(projects).toContainText("Core API");
  await expect(projects).toContainText("CORE");
  await expect(projects).not.toContainText("Brand site");
  await projects.getByRole("link", { name: /Core API/ }).click();
  await expect(eve.page).toHaveURL("/acme-robotics/projects/CORE");

  expect(await scrollsSideways(eve.page)).toBe(false);
  await close();
});

test("a Team with no members and no Projects says so, and an unknown Team is not found", async ({
  page,
  browser,
}) => {
  const { eve, close } = await seed({ page, browser });
  const empty = await createTeam(page, "Empty");

  await eve.page.goto(`/acme-robotics/teams/${empty.id}`);
  await expect(eve.page.getByText("No one is on this team yet.")).toBeVisible();
  await expect(eve.page.getByText("No projects for this team yet.")).toBeVisible();

  await eve.page.goto("/acme-robotics/teams/not-a-team");
  await expect(eve.page.getByRole("heading", { name: "Team not found" })).toBeVisible();
  await eve.page.getByRole("link", { name: "All teams" }).click();
  await expect(eve.page).toHaveURL("/acme-robotics/teams");
  await close();
});

const onPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

async function expectTouchTarget(page: Page, locator: Locator) {
  if (onPhone(page)) expect((await locator.boundingBox())?.height).toBeGreaterThanOrEqual(44);
}

test("an owner and an admin create Teams, and a taken name is refused", async ({
  page,
  browser,
}) => {
  const { cy, close } = await seed({ page, browser });
  await page.goto("/acme-robotics/teams");

  const open = page.getByRole("button", { name: "Create team" });
  await expectTouchTarget(page, open);
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Create team" });
  await dialog.getByLabel("Name").fill("Growth");
  await dialog.getByRole("button", { name: "Create team" }).click();
  await expect(dialog).toBeHidden();
  await expect(teamCard(page, "Growth")).toContainText("0 members");

  await page.getByRole("button", { name: "Create team" }).click();
  await dialog.getByLabel("Name").fill("growth");
  await dialog.getByRole("button", { name: "Create team" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("A team with that name already exists.");
  await dialog.getByLabel("Name").fill("  ");
  await dialog.getByRole("button", { name: "Create team" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter a name.");
  await page.keyboard.press("Escape");

  await cy.page.goto("/acme-robotics/teams");
  await cy.page.getByRole("button", { name: "Create team" }).click();
  await cy.page.getByRole("dialog").getByLabel("Name").fill("Support");
  await cy.page.getByRole("dialog").getByRole("button", { name: "Create team" }).click();
  await expect(teamCard(cy.page, "Support")).toBeVisible();
  await close();
});

test("an owner renames a Team, and its page and the list show the new name", async ({
  page,
  browser,
}) => {
  const { platform, close } = await seed({ page, browser });
  await page.goto(`/acme-robotics/teams/${platform.id}`);

  const rename = page.getByRole("button", { name: "Rename team" });
  await expectTouchTarget(page, rename);
  await rename.click();
  const dialog = page.getByRole("dialog", { name: "Rename team" });
  await expect(dialog.getByLabel("Name")).toHaveValue("Platform");
  await dialog.getByLabel("Name").fill("Design");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("A team with that name already exists.");
  await dialog.getByLabel("Name").fill("Platform engineering");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Platform engineering", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "All teams" }).click();
  await expect(teamCard(page, "Platform engineering")).toContainText("2 members");
  await close();
});

test("an owner adds a Company member to a Team, and the picker stops offering them", async ({
  page,
  browser,
}) => {
  const { platform, close } = await seed({ page, browser });
  await page.goto(`/acme-robotics/teams/${platform.id}`);

  const picker = page.getByLabel("Add a person");
  await expect(picker.locator("option")).toHaveText(["Choose someone", "Ada", "Cy", "Eve"]);
  const add = page.getByRole("button", { name: "Add to team" });
  await expectTouchTarget(page, add);
  await add.click();
  await expect(page.getByRole("alert")).toHaveText("Pick a member.");
  await picker.selectOption({ label: "Eve" });
  await add.click();

  await expect(memberRow(page, "Eve")).toContainText("eve@example.com");
  await expect(page.getByLabel("Team role for Eve")).toHaveValue("member");
  await expect(page.getByText("3 members")).toBeVisible();
  await expect(picker.locator("option")).toHaveText(["Choose someone", "Ada", "Cy"]);
  expect((await teamMembers(page, platform.id)).map((m) => m.email)).toContain("eve@example.com");
  await close();
});

test("a Team lead adds and removes people but cannot change a Team Role", async ({
  page,
  browser,
}) => {
  const { lee, platform, close } = await seed({ page, browser });
  await lee.page.goto(`/acme-robotics/teams/${platform.id}`);

  await expect(lee.page.getByLabel("Add a person")).toBeVisible();
  await expect(lee.page.getByRole("combobox", { name: /^Team role for/ })).toHaveCount(0);
  await expect(lee.page.getByRole("button", { name: "Rename team" })).toHaveCount(0);
  await expect(lee.page.getByRole("button", { name: "Delete team" })).toHaveCount(0);
  await expect(lee.page.getByRole("button", { name: "Remove Lee from team" })).toHaveCount(0);

  await lee.page.getByLabel("Add a person").selectOption({ label: "Eve" });
  await lee.page.getByRole("button", { name: "Add to team" }).click();
  await expect(memberRow(lee.page, "Eve")).toBeVisible();

  const removeBob = lee.page.getByRole("button", { name: "Remove Bob from team" });
  await expectTouchTarget(lee.page, removeBob);
  await removeBob.click();
  await expect(memberRow(lee.page, "Bob")).toHaveCount(0);
  await expect(lee.page.getByText("2 members")).toBeVisible();
  const emails = (await teamMembers(page, platform.id)).map((m) => m.email).sort();
  expect(emails).toEqual(["eve@example.com", "lee@example.com"]);
  await close();
});

test("an owner makes someone a lead and back to a member", async ({ page, browser }) => {
  const { platform, close } = await seed({ page, browser });
  await page.goto(`/acme-robotics/teams/${platform.id}`);

  const bobRole = page.getByLabel("Team role for Bob");
  await expectTouchTarget(page, bobRole);
  await expect(bobRole.locator("option")).toHaveText(["Lead", "Member"]);
  await bobRole.selectOption("lead");
  await expect(bobRole).toHaveValue("lead");
  await expect
    .poll(
      async () =>
        (await teamMembers(page, platform.id)).find((m) => m.email === "bob@example.com")?.role,
    )
    .toBe("lead");

  await bobRole.selectOption("member");
  await expect
    .poll(
      async () =>
        (await teamMembers(page, platform.id)).find((m) => m.email === "bob@example.com")?.role,
    )
    .toBe("member");
  await close();
});

test("a Team lead invites a new email to their Team, and it joins as a member on that Team", async ({
  page,
  browser,
}) => {
  const { lee, platform, design, close } = await seed({ page, browser });
  await inviteByApi(page, "company-only@example.com");
  await inviteByApi(page, "design-only@example.com", { teamId: design.id });
  await lee.page.goto(`/acme-robotics/teams/${platform.id}`);

  await expect(lee.page.getByLabel("Role", { exact: true })).toHaveCount(0);
  await lee.page.getByLabel("Email").fill("newbie@example.com");
  const create = lee.page.getByRole("button", { name: "Create invite" });
  await expectTouchTarget(lee.page, create);
  await create.click();

  const link = lee.page.getByLabel("Invite link");
  await expect(link).toHaveValue(/\/invite#.+/);
  const copy = lee.page.getByRole("button", { name: "Copy link" });
  await expectTouchTarget(lee.page, copy);
  await copy.click();
  await expect(lee.page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await lee.page.evaluate(() => navigator.clipboard.readText())).toBe(
    await link.inputValue(),
  );

  const pending = lee.page.getByRole("list", { name: "Pending invites" });
  await expect(pending.getByRole("listitem")).toHaveCount(1);
  await expect(pending).toContainText("newbie@example.com");
  await expect(pending).toContainText("Platform");
  expect(await scrollsSideways(lee.page)).toBe(false);

  const accepted = await joinByApi(browser, page, await link.inputValue(), {
    name: "Newbie",
    email: "newbie@example.com",
  });
  const members = await teamMembers(page, platform.id);
  expect(members.find((m) => m.email === "newbie@example.com")?.role).toBe("member");
  const company = (await (await page.request.get("/api/members")).json()) as {
    members: { email: string; role: string }[];
  };
  expect(company.members.find((m) => m.email === "newbie@example.com")?.role).toBe("member");
  await accepted.context.close();
  await close();
});

test("a Team lead resends and revokes their Team's Invites", async ({ page, browser }) => {
  const { lee, platform, close } = await seed({ page, browser });
  const { link: oldLink } = await inviteByApi(page, "newbie@example.com", {
    teamId: platform.id,
  });
  const lookup = async (link: string) =>
    (
      await page.request.post("/api/invite-links/lookup", {
        data: { token: link.split("#")[1] },
      })
    ).status();
  await lee.page.goto(`/acme-robotics/teams/${platform.id}`);

  const pending = lee.page.getByRole("list", { name: "Pending invites" });
  const resend = pending.getByRole("button", { name: "Resend" });
  await expectTouchTarget(lee.page, resend);
  await resend.click();
  const newLink = await lee.page.getByLabel("Invite link").inputValue();
  expect(await lookup(oldLink)).not.toBe(200);
  expect(await lookup(newLink)).toBe(200);

  await pending.getByRole("button", { name: "Revoke" }).click();
  await expect(pending).toHaveCount(0);
  expect(await lookup(newLink)).toBe(410);
  await close();
});

test("an owner can invite to a Team as an admin or a member, and sees only that Team's Invites", async ({
  page,
  browser,
}) => {
  const { platform, design, close } = await seed({ page, browser });
  await inviteByApi(page, "design-only@example.com", { teamId: design.id });
  await inviteByApi(page, "company-only@example.com");
  await page.goto(`/acme-robotics/teams/${platform.id}`);

  await expect(page.getByLabel("Role", { exact: true }).locator("option")).toHaveText([
    "Owner",
    "Admin",
    "Member",
  ]);
  await expect(page.getByRole("list", { name: "Pending invites" })).toHaveCount(0);
  await page.getByLabel("Email").fill("boss@example.com");
  await page.getByLabel("Role", { exact: true }).selectOption("admin");
  await page.getByRole("button", { name: "Create invite" }).click();

  const pending = page.getByRole("list", { name: "Pending invites" });
  await expect(pending.getByRole("listitem")).toHaveCount(1);
  await expect(pending).toContainText("boss@example.com");
  await expect(pending).toContainText("Admin");
  await close();
});

// What each Role sees. Platform is led by Lee and has Bob on it. Lee is only a member of Design.
const controlsByRole = [
  { who: "an owner", user: "ada", team: "platform", create: true, manage: true, people: true },
  { who: "an admin", user: "cy", team: "platform", create: true, manage: true, people: true },
  {
    who: "the Team's lead",
    user: "lee",
    team: "platform",
    create: false,
    manage: false,
    people: true,
  },
  {
    who: "a plain member of the Team",
    user: "bob",
    team: "platform",
    create: false,
    manage: false,
    people: false,
  },
  {
    who: "a member on no Team",
    user: "eve",
    team: "platform",
    create: false,
    manage: false,
    people: false,
  },
  {
    who: "a lead of another Team",
    user: "lee",
    team: "design",
    create: false,
    manage: false,
    people: false,
  },
] as const;

for (const row of controlsByRole) {
  test(`${row.who} sees the right controls on the Teams list and a Team page`, async ({
    page,
    browser,
  }) => {
    const seeded = await seed({ page, browser });
    await addTeamMember(page, seeded.design.id, "lee@example.com");
    const people = {
      ada: { page },
      cy: seeded.cy,
      lee: seeded.lee,
      bob: seeded.bob,
      eve: seeded.eve,
    };
    const viewer = people[row.user].page;
    const teamId = row.team === "platform" ? seeded.platform.id : seeded.design.id;
    await inviteByApi(page, "pending@example.com", { teamId });

    await viewer.goto("/acme-robotics/teams");
    await expect(teamCard(viewer, "Platform")).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Create team" })).toHaveCount(
      row.create ? 1 : 0,
    );

    await viewer.goto(`/acme-robotics/teams/${teamId}`);
    await expect(viewer.getByRole("list", { name: "People" })).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Rename team" })).toHaveCount(
      row.manage ? 1 : 0,
    );
    await expect(viewer.getByRole("button", { name: "Delete team" })).toHaveCount(
      row.manage ? 1 : 0,
    );
    await expect(viewer.getByLabel(/^Team role for/).first()).toBeVisible({ visible: row.manage });
    await expect(viewer.getByLabel("Add a person")).toHaveCount(row.people ? 1 : 0);
    await expect(viewer.getByRole("button", { name: "Create invite" })).toHaveCount(
      row.people ? 1 : 0,
    );
    await expect(viewer.getByRole("list", { name: "Pending invites" })).toHaveCount(
      row.people ? 1 : 0,
    );
    await expect(viewer.getByRole("button", { name: /^Remove .* from team$/ }).first()).toBeVisible(
      {
        visible: row.people,
      },
    );
    // Nobody gets controls on their own row.
    const me = row.user.charAt(0).toUpperCase() + row.user.slice(1);
    await expect(viewer.getByRole("button", { name: `Remove ${me} from team` })).toHaveCount(0);
    await expect(viewer.getByLabel(`Team role for ${me}`)).toHaveCount(0);

    expect(await scrollsSideways(viewer)).toBe(false);
    await seeded.close();
  });
}

test("the Teams pages hold long names without scrolling sideways, in the dark theme", async ({
  page,
  browser,
}) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  const longEmail =
    "bartholomew.maximilian.featherstonehaugh.cholmondeley@a-very-long-domain.example.com";
  const longName = "Bartholomew Maximilian Featherstonehaugh-Cholmondeley";
  const joined = await joinByApi(browser, page, (await inviteByApi(page, longEmail)).link, {
    name: longName,
    email: longEmail,
  });
  const team = await createTeam(
    page,
    "The Extraordinarily Long Platform Reliability Engineering Tooling Team",
  );
  await addTeamMember(page, team.id, longEmail, "lead");
  await createProject(page, {
    name: "A project name that is much longer than any card could possibly hold",
    key: "LONG",
    teamId: team.id,
  });
  await inviteByApi(page, `pending.${longEmail}`, { teamId: team.id });
  await page.emulateMedia({ colorScheme: "dark" });

  await page.goto("/acme-robotics/teams");
  await expect(teamCard(page, "Extraordinarily")).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);

  await page.goto(`/acme-robotics/teams/${team.id}`);
  await expect(memberRow(page, longEmail)).toBeVisible();
  await expect(page.getByRole("list", { name: "Projects" })).toContainText("LONG");
  await expect(page.getByRole("list", { name: "Pending invites" })).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await joined.context.close();
});

test("a refused change shows the server's message and keeps the list as it was", async ({
  page,
  browser,
}) => {
  const { platform, close } = await seed({ page, browser });
  await page.route("**/api/teams/*/members/*", (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ error: "You can't do that." }),
        })
      : route.continue(),
  );
  await page.goto(`/acme-robotics/teams/${platform.id}`);

  await page.getByRole("button", { name: "Remove Bob from team" }).click();

  await expect(page.getByRole("alert")).toHaveText("You can't do that.");
  await expect(memberRow(page, "Bob")).toBeVisible();
  await close();
});

test("an admin deletes a Team after confirming, and its Projects stay without a Team", async ({
  page,
  browser,
}) => {
  const { cy, platform, close } = await seed({ page, browser });
  await createProject(page, { name: "Core API", key: "CORE", teamId: platform.id });
  await cy.page.goto(`/acme-robotics/teams/${platform.id}`);

  const del = cy.page.getByRole("button", { name: "Delete team" });
  await expectTouchTarget(cy.page, del);
  await del.click();
  const dialog = cy.page.getByRole("dialog", { name: "Delete Platform?" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect((await page.request.get(`/api/teams/${platform.id}`)).status()).toBe(200);

  await del.click();
  await dialog.getByRole("button", { name: "Delete team" }).click();

  await expect(cy.page).toHaveURL("/acme-robotics/teams");
  await expect(teamCard(cy.page, "Design")).toBeVisible();
  await expect(teamCard(cy.page, "Platform")).toHaveCount(0);
  expect((await page.request.get(`/api/teams/${platform.id}`)).status()).toBe(404);
  const project = (await (await page.request.get("/api/projects/CORE")).json()) as {
    project: { team: unknown };
  };
  expect(project.project.team).toBeNull();
  await close();
});
