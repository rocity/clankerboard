import { type Browser, expect, type Page, test } from "@playwright/test";

export const password = "correct-horse-battery";

/** Signs up through the sign-up screen and waits until the app has left it. */
export async function signUp(page: Page, name: string, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).not.toHaveURL(/\/sign-up/);
}

export async function signIn(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

type CompanyRow = { id: string; name: string; slug: string; role: string };

/** Creates a Company as the signed-in User. It becomes their session's active Company. */
export async function createCompany(page: Page, name: string) {
  const res = await page.request.post("/api/companies", { data: { name } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { company: CompanyRow }).company;
}

export async function companies(page: Page) {
  const res = await page.request.get("/api/companies");
  return (await res.json()) as { companies: CompanyRow[]; activeCompanyId: string | null };
}

/**
 * Invites `email` to the signed-in User's active Company, then signs them up in a
 * fresh browser context that matches the running project's viewport and theme.
 */
export async function joinCompany(
  owner: Page,
  browser: Browser,
  invitee: { name: string; email: string; role?: "member" | "admin" },
) {
  const res = await owner.request.post("/api/invites", {
    data: { email: invitee.email, role: invitee.role ?? "member" },
  });
  expect(res.status()).toBe(201);
  const { link } = (await res.json()) as { link: string };

  const { viewport, colorScheme, hasTouch } = test.info().project.use;
  const context = await browser.newContext({ viewport, colorScheme, hasTouch });
  const page = await context.newPage();
  await page.goto(link);
  await page.getByLabel("Name").fill(invitee.name);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).not.toHaveURL(/\/invite/);
  return page;
}

/** True when the page scrolls sideways, which breaks the mobile layout. */
export function scrollsSideways(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}
