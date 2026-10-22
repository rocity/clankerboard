import { expect, test } from "@playwright/test";
import { resetDatabase } from "./database";
import { createCompany, password, scrollsSideways, signIn, signUp } from "./helpers";

test.beforeEach(resetDatabase);

test("a first User signs up, creates a Company, signs out, and signs back in to it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByRole("link", { name: "Sign up" }).click();
  await page.getByLabel("Name").fill("Ada");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();

  // No Company yet, so the app asks for one.
  await expect(page.getByRole("heading", { name: "Create your company" })).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await page.getByLabel("Company name").fill("Acme Robotics");
  await page.getByRole("button", { name: "Create company" }).click();

  await expect(page).toHaveURL("/acme-robotics");
  await expect(page.getByRole("heading", { name: "Acme Robotics" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Company" })).toHaveText("Acme Robotics");

  await page.getByRole("button", { name: "User menu" }).click();
  await expect(page.getByText("ada@example.com")).toBeVisible();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  // A new session has no active Company, so this lands on the one the browser used last.
  await signIn(page, "ada@example.com");
  await expect(page).toHaveURL("/acme-robotics");
  await expect(page.getByRole("heading", { name: "Acme Robotics" })).toBeVisible();
});

test("a wrong password shows a plain message and stays on sign-in", async ({ page }) => {
  await signUp(page, "Ada", "ada@example.com");
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("alert")).toHaveText("Invalid email or password");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("the sign-up screen says up front that it needs an Invite", async ({ page, browser }) => {
  await signUp(page, "Ada", "ada@example.com");

  const stranger = await browser.newPage();
  await stranger.goto("/sign-up");

  await expect(stranger.getByRole("heading", { name: "Sign up" })).toBeVisible();
  await expect(stranger.getByText("Sign-up needs an invite.")).toBeVisible();
  await expect(stranger.getByLabel("Name")).toHaveCount(0);
  await expect(stranger.getByRole("button", { name: "Sign up" })).toHaveCount(0);
  await stranger.getByRole("link", { name: "Sign in" }).click();
  await expect(stranger.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await stranger.close();
});

test("the sign-up screen shows the server's refusal when it offered the form anyway", async ({
  page,
  browser,
}) => {
  await signUp(page, "Ada", "ada@example.com");

  const stranger = await browser.newPage();
  await stranger.route("**/api/config", (route) =>
    route.fulfill({ json: { publicUrl: "http://localhost", signUpOpen: true } }),
  );
  await stranger.goto("/sign-up");
  await stranger.getByLabel("Name").fill("Eve");
  await stranger.getByLabel("Email").fill("eve@example.com");
  await stranger.getByLabel("Password").fill(password);
  await stranger.getByRole("button", { name: "Sign up" }).click();

  await expect(stranger.getByRole("alert")).toHaveText("Sign-up needs an invite.");
  await stranger.close();
});

test.describe("OAuth buttons", () => {
  test("show only the providers the server enabled", async ({ page }) => {
    await page.route("**/api/auth-providers", (route) =>
      route.fulfill({ json: { providers: ["github"] } }),
    );
    await page.goto("/sign-in");

    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  });

  test("are absent when no provider is enabled", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await expect(page.getByRole("button", { name: /Continue with/ })).toHaveCount(0);
  });

  test("start the provider flow for the one that was clicked", async ({ page }) => {
    await page.route("**/api/auth-providers", (route) =>
      route.fulfill({ json: { providers: ["google"] } }),
    );
    let asked = "";
    await page.route("**/api/auth/sign-in/social", (route) => {
      asked = route.request().postData() ?? "";
      return route.fulfill({ json: { url: "/sign-up", redirect: true } });
    });
    await page.goto("/sign-in");

    await page.getByRole("button", { name: "Continue with Google" }).click();

    await expect(page).toHaveURL(/\/sign-up/);
    expect(JSON.parse(asked)).toMatchObject({ provider: "google", callbackURL: "/" });
  });
});

test("a sign-in in a fresh browser lands on one of the User's Companies", async ({
  page,
  browser,
}) => {
  await signUp(page, "Ada", "ada@example.com");
  await createCompany(page, "Acme Robotics");
  await createCompany(page, "Globex");

  // This browser has no remembered Company and its new session has no active one.
  const fresh = await browser.newPage();
  await fresh.goto("/sign-in");
  await signIn(fresh, "ada@example.com");

  await expect(fresh).toHaveURL(/\/(acme-robotics|globex)$/);
  await expect(fresh.getByRole("button", { name: "Company" })).toBeVisible();
  await fresh.close();
});
