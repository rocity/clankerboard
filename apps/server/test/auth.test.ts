import { describe, expect, it } from "vitest";
import { buildTestApp, plainCopy } from "./harness";

describe("email and password auth", () => {
  it("signs up the first User on an empty instance and returns their profile", async () => {
    const t = buildTestApp({ config: { openSignup: false } });

    const alice = await t.signUp({ email: "alice@example.com", name: "Alice" });
    const res = await alice.request("/api/me");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      user: { email: "alice@example.com", name: "Alice", image: null },
    });
  });

  it("signs in with the right password and signs out", async () => {
    const t = buildTestApp();
    await t.signUp({ email: "alice@example.com", password: "correct-horse-battery" });

    const alice = await t.signIn({ email: "alice@example.com", password: "correct-horse-battery" });
    expect((await alice.request("/api/me")).status).toBe(200);

    const out = await alice.request("/api/auth/sign-out", { method: "POST" });
    expect(out.status).toBe(200);
    const after = await alice.request("/api/me");
    expect(after.status).toBe(401);
    expect(await after.json()).toEqual({ error: "Sign in first." });
  });

  it("rejects a second sign-up without an Invite when open sign-up is off", async () => {
    const t = buildTestApp({ config: { openSignup: false } });
    await t.signUp({ email: "alice@example.com" });

    const res = await t.request("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email: "mallory@example.com", password: "password-1234", name: "M" }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ message: "Sign-up needs an invite." });
  });

  it("accepts any sign-up when open sign-up is on", async () => {
    const t = buildTestApp({ config: { openSignup: true } });
    await t.signUp({ email: "alice@example.com" });

    const bob = await t.signUp({ email: "bob@example.com" });

    expect((await bob.request("/api/me")).status).toBe(200);
  });

  it.each([
    ["wrong password", "alice@example.com", "not-the-password"],
    ["unknown email", "nobody@example.com", "correct-horse-battery"],
  ])("returns a short, plain error for a %s", async (_case, email, password) => {
    const t = buildTestApp();
    await t.signUp({ email: "alice@example.com", password: "correct-horse-battery" });

    const res = await t.request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    expect(res.status).toBe(401);
    const { message } = (await res.json()) as { message: string };
    expect(message).toBe("Invalid email or password");
    expect(plainCopy(message)).toBe(true);
  });
});
