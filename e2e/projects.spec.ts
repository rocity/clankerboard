import { expect, type Page, test } from "@playwright/test";
import { resetDatabase } from "./database";
import {
  createCompany,
  createProject,
  createTeam,
  scrollsSideways,
  settledBox,
  signUp,
} from "./helpers";

test.beforeEach(resetDatabase);

// Runs at 1280px in light and at 375px in dark (see playwright.config.ts).

async function openCompany(page: Page) {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await page.goto("/acme-robotics");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
}

test("a Company with no Projects offers to create one", async ({ page }) => {
  await openCompany(page);

  await expect(page.getByText("No projects yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create project" })).toBeVisible();
});

test("creates a Project with its Project Key and opens its board", async ({ page }) => {
  await openCompany(page);

  await page.getByRole("button", { name: "Create project" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Create project" });
  await dialog.getByLabel("Name").fill("Platform");
  await dialog.getByLabel("Project Key").fill("plat");
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL("/acme-robotics/projects/PLAT");
  await expect(page.getByRole("heading", { name: "Platform" })).toBeVisible();
});

test("shows a taken Project Key in the dialog and keeps it open", async ({ page }) => {
  await openCompany(page);
  await createProject(page, { name: "Platform", key: "PLAT" });
  await page.reload();

  await page.getByRole("button", { name: "Create project" }).click();
  const dialog = page.getByRole("dialog", { name: "Create project" });
  await dialog.getByLabel("Name").fill("Other");
  await dialog.getByLabel("Project Key").fill("PLAT");
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("That project key is taken.");
  await dialog.getByLabel("Project Key").fill("p");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Project keys are 2 to 10 uppercase letters.");
});

test("lists Projects with their key and Team, and filters them by Team", async ({ page }) => {
  await openCompany(page);
  const platform = await createTeam(page, "Platform");
  const mobile = await createTeam(page, "Mobile");
  await createProject(page, { name: "Core API", key: "API", teamId: platform.id });
  await createProject(page, { name: "Phone App", key: "APP", teamId: mobile.id });
  await createProject(page, { name: "Website", key: "WEB" });
  await page.reload();

  const list = page.getByRole("list", { name: "Projects" });
  await expect(list.getByRole("link")).toHaveCount(3);
  await expect(list.getByRole("link", { name: /Core API/ })).toContainText("API");
  await expect(list.getByRole("link", { name: /Core API/ })).toContainText("Platform");

  await page.getByLabel("Team").selectOption({ label: "Mobile" });

  await expect(list.getByRole("link")).toHaveCount(1);
  await expect(list.getByRole("link", { name: /Phone App/ })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("team")).toBe(mobile.id);

  // The filter is in the URL, so it survives a reload.
  await page.reload();
  await expect(page.getByLabel("Team")).toHaveValue(mobile.id);
  await expect(list.getByRole("link")).toHaveCount(1);

  await page.getByLabel("Team").selectOption({ label: "All teams" });
  await expect(list.getByRole("link")).toHaveCount(3);
});

test("a filter that matches nothing says so", async ({ page }) => {
  await openCompany(page);
  await createTeam(page, "Platform");
  await createProject(page, { name: "Website", key: "WEB" });
  await page.reload();

  await page.getByLabel("Team").selectOption({ label: "Platform" });

  await expect(page.getByText("No projects for this team.")).toBeVisible();
});

test("a Project can be created under a Team from the dialog", async ({ page }) => {
  await openCompany(page);
  const platform = await createTeam(page, "Platform");
  await page.reload();

  await page.getByRole("button", { name: "Create project" }).click();
  const dialog = page.getByRole("dialog", { name: "Create project" });
  await dialog.getByLabel("Name").fill("Core API");
  await dialog.getByLabel("Project Key").fill("API");
  await dialog.getByLabel("Team").selectOption(platform.id);
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL("/acme-robotics/projects/API");
  await page.goto("/acme-robotics");
  await expect(page.getByRole("link", { name: /Core API/ })).toContainText("Platform");
});

test("the Projects list fits the viewport and its controls are touch sized", async ({ page }) => {
  await openCompany(page);
  await createProject(page, {
    name: "A Project With A Very Long Name That Keeps Going And Going",
    key: "LONG",
  });
  await page.reload();
  await expect(page.getByRole("link", { name: /A Project With/ })).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);

  const onPhone = (page.viewportSize()?.width ?? 0) < 768;
  if (!onPhone) return;
  for (const control of [
    page.getByLabel("Team"),
    page.getByRole("button", { name: "Create project" }),
  ]) {
    expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("button", { name: "Create project" }).click();
  const close = page.getByRole("dialog").getByRole("button", { name: "Close" });
  const box = await settledBox(close);
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
});

test("an unknown Project Key says so", async ({ page }) => {
  await openCompany(page);

  await page.goto("/acme-robotics/projects/NOPE");

  await expect(page.getByRole("heading", { name: "Project not found" })).toBeVisible();
  await page.getByRole("link", { name: "Back to projects" }).click();
  await expect(page).toHaveURL("/acme-robotics");
});
