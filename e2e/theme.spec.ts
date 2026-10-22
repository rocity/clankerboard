import { expect, type Page, test } from "@playwright/test";
import { resetDatabase } from "./database";
import { createCompany, signUp } from "./helpers";

test.beforeEach(resetDatabase);

// The key is recorded in .claude/skills/redesign/SKILL.md.
const storageKey = "agentkanban-theme";

const isDark = (page: Page) =>
  page.evaluate(() => document.documentElement.classList.contains("dark"));
const pageBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

async function choose(page: Page, label: "Light" | "Dark" | "System") {
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("menuitemradio", { name: label }).click();
}

test.describe("with a dark system preference", () => {
  test.use({ colorScheme: "dark" });

  test("the app follows the system, and a manual override persists across reloads", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    expect(await isDark(page)).toBe(true);
    const darkBackground = await pageBackground(page);

    await choose(page, "Light");
    expect(await isDark(page)).toBe(false);
    expect(await pageBackground(page)).not.toBe(darkBackground);
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe("light");

    await page.reload();
    expect(await isDark(page)).toBe(false);

    await choose(page, "System");
    expect(await isDark(page)).toBe(true);
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
  });

  test("the saved choice is applied before the app code runs", async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "light"), storageKey);
    // Stop the app bundle, so only index.html's inline script can have set the theme.
    await page.route("**/assets/*.js", (route) => route.abort());

    await page.goto("/sign-in");

    expect(await isDark(page)).toBe(false);
  });
});

test.describe("with a light system preference", () => {
  test.use({ colorScheme: "light" });

  test("the system choice follows a live change of the preference", async ({ page }) => {
    await page.goto("/sign-in");
    expect(await isDark(page)).toBe(false);

    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => isDark(page)).toBe(true);
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => isDark(page)).toBe(false);
  });

  test("a dark override holds inside a Company too", async ({ page }) => {
    await signUp(page, "Ada", "ada@example.com");
    await createCompany(page, "Acme Robotics");
    await page.goto("/acme-robotics");

    await choose(page, "Dark");

    expect(await isDark(page)).toBe(true);
    await page.reload();
    expect(await isDark(page)).toBe(true);
    await expect(page.getByRole("heading", { name: "Acme Robotics" })).toBeVisible();
  });
});
