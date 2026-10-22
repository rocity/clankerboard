import { type Browser, expect, type Page } from "@playwright/test";

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

type InviteRow = { id: string; email: string; role: string; status: string };

/** Creates an Invite over HTTP as the signed-in User, for tests that do not exercise the Invite form. */
export async function inviteByApi(
  page: Page,
  email: string,
  options: { role?: string; teamId?: string } = {},
) {
  const res = await page.request.post("/api/invites", { data: { email, ...options } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { invite: InviteRow; link: string };
}

/**
 * Opens a fresh browser context for a new User and joins them to the Company through an
 * Invite link, over HTTP. The returned page is signed in with that Company active.
 */
export async function joinByApi(
  browser: Browser,
  like: Page,
  link: string,
  user: { name: string; email: string },
) {
  const origin = new URL(link).origin;
  const token = link.split("#")[1] ?? "";
  const dark = await like.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const context = await browser.newContext({
    viewport: like.viewportSize(),
    colorScheme: dark ? "dark" : "light",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const signUpRes = await context.request.post(`${origin}/api/auth/sign-up/email`, {
    data: { ...user, password },
    headers: { origin, "x-invite-token": token },
  });
  expect(signUpRes.status()).toBe(200);
  const acceptRes = await context.request.post(`${origin}/api/invite-links/accept`, {
    data: { token },
    headers: { origin },
  });
  expect(acceptRes.status()).toBe(200);
  return { context, page: await context.newPage() };
}

/** True when the page scrolls sideways, which breaks the mobile layout. */
export function scrollsSideways(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}
