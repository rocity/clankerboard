import { expect, type Page } from "@playwright/test";

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

/** True when the page scrolls sideways, which breaks the mobile layout. */
export function scrollsSideways(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}
