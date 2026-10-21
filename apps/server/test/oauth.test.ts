import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, type TestApp } from "./harness";

const github = { clientId: "gh-client", clientSecret: "gh-secret" };
const google = { clientId: "google-client", clientSecret: "google-secret" };

function cookiesFrom(res: Response) {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

// GitHub is the external boundary: stand in for its token and profile endpoints.
function fakeGitHub(email: string) {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const json = (body: unknown) => Response.json(body);
    if (url.href === "https://github.com/login/oauth/access_token") {
      return json({ access_token: "gh-token", token_type: "bearer", scope: "user:email" });
    }
    if (url.href === "https://api.github.com/user") {
      return json({ id: 4242, login: "octo", name: "Octo Cat", email, avatar_url: null });
    }
    if (url.href === "https://api.github.com/user/emails") {
      return json([{ email, primary: true, verified: true }]);
    }
    return realFetch(input, init);
  });
}

async function signInWithGitHub(t: TestApp) {
  const start = await t.request("/api/auth/sign-in/social", {
    method: "POST",
    body: JSON.stringify({ provider: "github", callbackURL: "/", errorCallbackURL: "/sign-in" }),
  });
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state");
  return t.requestAs(cookiesFrom(start))(`/api/auth/callback/github?code=abc&state=${state}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("optional OAuth providers", () => {
  it("exposes no OAuth providers when none are configured", async () => {
    const t = buildTestApp();

    const res = await t.request("/api/auth-providers");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ providers: [] });
  });

  it("enables each provider only when its credentials are present", async () => {
    const onlyGitHub = buildTestApp({ config: { oauth: { github } } });
    const both = buildTestApp({ config: { oauth: { github, google } } });

    expect(await (await onlyGitHub.request("/api/auth-providers")).json()).toEqual({
      providers: ["github"],
    });
    expect(await (await both.request("/api/auth-providers")).json()).toEqual({
      providers: ["github", "google"],
    });
  });

  it("refuses to start an OAuth sign-in for a provider that is not configured", async () => {
    const t = buildTestApp({ config: { oauth: { github } } });

    const res = await t.request("/api/auth/sign-in/social", {
      method: "POST",
      body: JSON.stringify({ provider: "google", callbackURL: "/" }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("signs up the first User through GitHub", async () => {
    const t = buildTestApp({ config: { openSignup: false, oauth: { github } } });
    fakeGitHub("octo@example.com");

    const callback = await signInWithGitHub(t);

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).not.toContain("error");
    const me = await t.requestAs(cookiesFrom(callback))("/api/me");
    expect(await me.json()).toMatchObject({
      user: { email: "octo@example.com", name: "Octo Cat" },
    });
  });

  it("applies the sign-up policy to OAuth sign-ups", async () => {
    const t = buildTestApp({ config: { openSignup: false, oauth: { github } } });
    await t.signUp({ email: "alice@example.com" });
    fakeGitHub("octo@example.com");

    const callback = await signInWithGitHub(t);

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toContain("error=");
    const me = await t.requestAs(cookiesFrom(callback))("/api/me");
    expect(me.status).toBe(401);
  });
});
