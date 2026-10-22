import { expect, test } from "@playwright/test";
import { resetDatabase } from "./database";
import { createCompany, signIn, signUp } from "./helpers";

test.beforeEach(resetDatabase);

test("an expired session on a deep link goes to sign-in and back to the same URL", async ({
  page,
  context,
}) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await context.clearCookies();

  await page.goto("/acme-robotics?view=mine");

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("redirect")).toBe("/acme-robotics?view=mine");
  await signIn(page, "ada@example.com");
  await expect(page).toHaveURL("/acme-robotics?view=mine");
  await expect(page.getByRole("heading", { name: "Acme Robotics" })).toBeVisible();
});

test("a session that expires while the page is open sends the next action to sign-in", async ({
  page,
  context,
}) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await page.goto("/acme-robotics");
  await expect(page.getByRole("heading", { name: "Acme Robotics" })).toBeVisible();
  await context.clearCookies();

  await page.getByRole("button", { name: "Company" }).click();
  await page.getByRole("menuitem", { name: "Create company" }).click();
  await page.getByLabel("Company name").fill("Globex");
  await page.getByRole("button", { name: "Create company" }).click();

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("redirect")).toBe("/acme-robotics");
  await signIn(page, "ada@example.com");
  await expect(page).toHaveURL("/acme-robotics");
});

test("a sign-in link to another site is ignored", async ({ page }) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await page.goto("/sign-in?redirect=//evil.example/path");
  await signIn(page, "ada@example.com");

  await expect(page).toHaveURL("/acme-robotics");
});
