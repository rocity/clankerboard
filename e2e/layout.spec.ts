import { expect, test } from "@playwright/test";
import { resetDatabase } from "./database";
import { createCompany, scrollsSideways, signUp } from "./helpers";

test.beforeEach(resetDatabase);

// Runs at 1280px in light and at 375px in dark (see playwright.config.ts).

test("the auth screens fit the viewport", async ({ page }) => {
  for (const path of ["/sign-in", "/sign-up"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: /^Sign (in|up)$/ })).toBeInViewport();
    expect(await scrollsSideways(page)).toBe(false);
  }
});

test("the header fits the viewport with a long Company name, and its controls are touch sized", async ({
  page,
}) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "The Extremely Long Named Company of Robotic Enterprises Inc");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Company" })).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);

  const width = page.viewportSize()?.width ?? 0;
  const onPhone = width < 768;
  for (const name of ["Company", "Appearance", "Account"]) {
    const box = await page.getByRole("button", { name }).boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    if (onPhone) expect(box?.height).toBeGreaterThanOrEqual(44);
    if (onPhone && name !== "Company") expect(box?.width).toBeGreaterThanOrEqual(44);
  }
});
