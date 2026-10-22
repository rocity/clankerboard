import { describe, expect, it } from "vitest";
import { buildTestApp } from "./harness";

describe("public config", () => {
  it("tells a signed-out visitor the public URL the Agent setup should use", async () => {
    const t = buildTestApp({ config: { baseUrl: "https://board.example.com" } });

    const res = await t.request("/api/config");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ publicUrl: "https://board.example.com" });
  });

  it("says sign-up is open when the operator turned open sign-up on", async () => {
    const t = buildTestApp({ config: { openSignup: true } });
    await t.signUp({ email: "alice@example.com" });

    const res = await t.request("/api/config");

    expect(await res.json()).toMatchObject({ signUpOpen: true });
  });

  it("says sign-up is open on an empty instance, and closed once someone has signed up", async () => {
    const t = buildTestApp({ config: { openSignup: false } });

    const empty = await (await t.request("/api/config")).json();
    await t.signUp({ email: "alice@example.com" });
    const used = await (await t.request("/api/config")).json();

    expect(empty).toMatchObject({ signUpOpen: true });
    expect(used).toMatchObject({ signUpOpen: false });
  });

  it("exposes nothing else", async () => {
    const t = buildTestApp();

    const body = await (await t.request("/api/config")).json();

    expect(Object.keys(body as object).sort()).toEqual(["publicUrl", "signUpOpen"]);
  });
});
