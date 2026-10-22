import { expect, test } from "@playwright/test";
import { resetDatabase } from "./database";
import { companies, createCompany, scrollsSideways, signUp } from "./helpers";

test.beforeEach(resetDatabase);

test("the Company switcher changes the active Company", async ({ page }) => {
  await signUp(page, "Ada", "ada@example.com");
  const acme = await createCompany(page, "Acme Robotics");
  const globex = await createCompany(page, "Globex");
  // Creating Globex made it the session's active Company. Opening Acme's URL switches back.
  await page.goto("/acme-robotics");
  await expect(page.getByRole("heading", { name: "Acme Robotics" })).toBeVisible();
  expect((await companies(page)).activeCompanyId).toBe(acme.id);

  await page.getByRole("button", { name: "Company" }).click();
  await expect(page.getByRole("menuitem", { name: "Acme Robotics" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Globex" }).click();

  await expect(page).toHaveURL("/globex");
  await expect(page.getByRole("heading", { name: "Globex" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Company" })).toHaveText("Globex");
  expect((await companies(page)).activeCompanyId).toBe(globex.id);
  expect(await scrollsSideways(page)).toBe(false);
});

test("a Company can be created from the switcher", async ({ page }) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await page.goto("/acme-robotics");

  await page.getByRole("button", { name: "Company" }).click();
  await page.getByRole("menuitem", { name: "Create company" }).click();
  await page.getByLabel("Company name").fill("Initech");
  await page.getByRole("button", { name: "Create company" }).click();

  await expect(page).toHaveURL("/initech");
  await expect(page.getByRole("heading", { name: "Initech" })).toBeVisible();
  const { companies: rows, activeCompanyId } = await companies(page);
  expect(rows.map((c) => c.slug).sort()).toEqual(["acme-robotics", "initech"]);
  expect(rows.find((c) => c.slug === "initech")?.id).toBe(activeCompanyId);
});

test("the root path opens the Company used last", async ({ page }) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await createCompany(page, "Globex");
  await page.goto("/acme-robotics");
  await expect(page.getByRole("heading", { name: "Acme Robotics" })).toBeVisible();

  await page.goto("/");

  await expect(page).toHaveURL("/acme-robotics");
});

test("a Company address the User does not belong to says so", async ({ page }) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");

  await page.goto("/not-a-company");

  await expect(page.getByRole("heading", { name: "Company not found" })).toBeVisible();
  await page.getByRole("link", { name: "Go home" }).click();
  await expect(page).toHaveURL("/acme-robotics");
});

test("a Company cannot take a reserved address", async ({ page }) => {
  await signUp(page, "Ada", "ada@example.com");
  await page.goto("/");
  await page.getByLabel("Company name").fill("API");
  await page.getByRole("button", { name: "Create company" }).click();

  await expect(page).toHaveURL(/\/api-[a-z0-9]+$/);
});
