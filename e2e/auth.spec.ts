import { expect, test } from "@playwright/test";

test("the first User signs up, sees their profile, and signs out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByRole("link", { name: "Sign up" }).click();
  await page.getByLabel("Name").fill("Ada");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page.getByText("Signed in as Ada (ada@example.com)")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
