import { expect, test } from "@playwright/test";
import { resetDatabase } from "./database";
import { createCompany, password, signUp } from "./helpers";

test.beforeEach(resetDatabase);

test("an invitee opens the link in a fresh browser, signs up, and joins the Company", async ({
  page,
  browser,
}) => {
  await signUp(page, "Grace", "grace@example.com");
  await createCompany(page, "Acme Robotics");
  // The members page that creates Invites in the browser comes with its own card.
  const res = await page.request.post("/api/invites", {
    data: { email: "linus@example.com", role: "member" },
  });
  expect(res.status()).toBe(201);
  const { link } = (await res.json()) as { link: string };
  expect(link).toContain("/invite#");

  // Open sign-up is off here, so only the Invite lets this person in.
  const inviteeContext = await browser.newContext({
    viewport: page.viewportSize(),
    colorScheme: "dark",
  });
  const invitee = await inviteeContext.newPage();
  await invitee.goto(link);
  await expect(
    invitee.getByText("Grace invited you to join Acme Robotics as member."),
  ).toBeVisible();
  await expect(invitee.getByLabel("Email")).toHaveValue("linus@example.com");
  await invitee.getByLabel("Name").fill("Linus");
  await invitee.getByLabel("Password").fill(password);
  await invitee.getByRole("button", { name: "Sign up" }).click();

  await expect(invitee).toHaveURL("/acme-robotics");
  await expect(invitee.getByRole("heading", { name: "Acme Robotics" })).toBeVisible();
  await expect(invitee.getByText("Your role: member")).toBeVisible();

  await inviteeContext.close();
});
