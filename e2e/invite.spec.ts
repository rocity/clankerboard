import { expect, test } from "@playwright/test";
import { resetDatabase } from "./database";

test.beforeEach(resetDatabase);

test("an owner invites a second User by copied link and they join from a fresh browser", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext();
  await ownerContext.grantPermissions(["clipboard-read", "clipboard-write"]);
  const owner = await ownerContext.newPage();

  await owner.goto("/sign-up");
  await owner.getByLabel("Name").fill("Grace");
  await owner.getByLabel("Email").fill("grace@example.com");
  await owner.getByLabel("Password").fill("correct-horse-battery");
  await owner.getByRole("button", { name: "Sign up" }).click();

  await owner.getByLabel("Company name").fill("Acme Robotics");
  await owner.getByRole("button", { name: "Create company" }).click();
  await expect(owner.getByRole("heading", { name: "Acme Robotics" })).toBeVisible();

  await owner.getByLabel("Invite email").fill("linus@example.com");
  await owner.getByRole("button", { name: "Create invite" }).click();
  await owner.getByRole("button", { name: "Copy link" }).click();
  await expect(owner.getByRole("button", { name: "Copied" })).toBeVisible();
  const link = await owner.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain("/invite#");

  // Open sign-up is off here, so only the Invite lets this person in.
  const inviteeContext = await browser.newContext();
  const invitee = await inviteeContext.newPage();
  await invitee.goto(link);
  await expect(
    invitee.getByText("Grace invited you to join Acme Robotics as member."),
  ).toBeVisible();
  await expect(invitee.getByLabel("Email")).toHaveValue("linus@example.com");
  await invitee.getByLabel("Name").fill("Linus");
  await invitee.getByLabel("Password").fill("correct-horse-battery");
  await invitee.getByRole("button", { name: "Sign up" }).click();

  await expect(invitee.getByText("Signed in as Linus (linus@example.com)")).toBeVisible();
  await expect(invitee.getByRole("heading", { name: "Acme Robotics" })).toBeVisible();
  await expect(invitee.getByText("Your role: member")).toBeVisible();

  await ownerContext.close();
  await inviteeContext.close();
});
