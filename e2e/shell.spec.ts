import { expect, test } from "@playwright/test";

test("loads the web shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Clankerboard" })).toBeVisible();
});
