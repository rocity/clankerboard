import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createAgent,
  createApiKey,
  createCompany,
  type SignedInUser,
  type TestApp,
} from "./harness";

/** Acme where `boss` (an admin unless told otherwise) runs an Agent. */
async function setup(t: TestApp, role: "owner" | "admin" = "admin") {
  const { company, owner, members } = await createCompany(t, {
    name: "Acme",
    members: [
      { email: "boss@example.com", role },
      { email: "bob@example.com", role: "member" },
    ],
  });
  const [boss, bob] = members as [SignedInUser, SignedInUser];
  const agent = await createAgent(boss, "Boss-Agent");
  const { bearer } = await createApiKey(t, boss, agent.id);
  const teamRes = await owner.request("/api/teams", {
    method: "POST",
    body: JSON.stringify({ name: "Platform" }),
  });
  const { team } = (await teamRes.json()) as { team: { id: string } };
  await owner.request(`/api/teams/${team.id}/members`, {
    method: "POST",
    body: JSON.stringify({ userId: bob.user.id }),
  });
  return { company, owner, boss, bob, agent, bearer, team };
}

describe("Agent permissions", () => {
  it("acts with its owner's Role, and loses admin abilities as soon as the owner is demoted", async () => {
    const t = buildTestApp();
    const { owner, boss, bearer } = await setup(t, "admin");
    const rename = () =>
      bearer("/api/company", { method: "PATCH", body: JSON.stringify({ name: "Acme Two" }) });

    expect((await rename()).status).toBe(200);

    await owner.request(`/api/members/${boss.user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ role: "member" }),
    });

    expect((await rename()).status).toBe(403);
    expect(await (await bearer("/api/whoami")).json()).toMatchObject({
      company: { role: "member" },
    });
  });

  it("can do non-delete work its owner can do", async () => {
    const t = buildTestApp();
    const { bearer } = await setup(t, "admin");

    const team = await bearer("/api/teams", {
      method: "POST",
      body: JSON.stringify({ name: "Ops" }),
    });
    const invite = await bearer("/api/invites", {
      method: "POST",
      body: JSON.stringify({ email: "new@example.com", role: "member" }),
    });

    expect(team.status).toBe(201);
    expect(invite.status).toBe(201);
  });

  describe("never deletes, even for an owner", () => {
    it.each([
      ["remove a member", (s: Setup) => [`/api/members/${s.bob.user.id}`]],
      ["make its owner leave", (s: Setup) => [`/api/members/${s.boss.user.id}`]],
      ["delete a Team", (s: Setup) => [`/api/teams/${s.team.id}`]],
      ["remove a Team member", (s: Setup) => [`/api/teams/${s.team.id}/members/${s.bob.user.id}`]],
    ])("cannot %s", async (_action, path) => {
      const t = buildTestApp();
      const s = await setup(t, "owner");
      const [target] = path(s) as [string];

      const res = await s.bearer(target, { method: "DELETE" });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Agents can't delete anything." });
      const members = await (await s.owner.request("/api/members")).text();
      expect(members).toContain(s.bob.user.email);
      expect(members).toContain(s.boss.user.email);
      const team = await (await s.owner.request(`/api/teams/${s.team.id}`)).text();
      expect(team).toContain(s.bob.user.email);
    });
  });

  it.each([
    ["create an Agent", "POST", "/api/agents", { name: "Child" }],
    ["rename an Agent", "PATCH", "/api/agents/:agent", { name: "Renamed" }],
    ["revoke an Agent", "POST", "/api/agents/:agent/revoke", undefined],
    ["create an API Key", "POST", "/api/agents/:agent/keys", { label: "more" }],
    ["revoke an API Key", "POST", "/api/agents/:agent/keys/:key/revoke", undefined],
  ])("cannot %s", async (_action, method, path, body) => {
    const t = buildTestApp();
    const { boss, agent } = await setup(t, "owner");
    const { key, bearer } = await createApiKey(t, boss, agent.id, "second");

    const res = await bearer(path.replace(":agent", agent.id).replace(":key", key.id), {
      method,
      body: body ? JSON.stringify(body) : undefined,
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Agents can't manage agents or API keys." });
  });

  it.each([
    [
      "is removed",
      (s: Setup) => s.owner.request(`/api/members/${s.boss.user.id}`, { method: "DELETE" }),
    ],
    [
      "leaves",
      (s: Setup) => s.boss.request(`/api/members/${s.boss.user.id}`, { method: "DELETE" }),
    ],
  ])("revokes all of a User's Agents when the User %s", async (_how, removal) => {
    const t = buildTestApp();
    const s = await setup(t);
    const second = await createAgent(s.boss, "Boss-Agent-2");
    const secondKey = await createApiKey(t, s.boss, second.id);
    const elsewhere = await createCompany(t, { name: "Globex", owner: s.boss });
    const globexAgent = await createAgent(s.boss, "Globex-Agent");
    const globexKey = await createApiKey(t, s.boss, globexAgent.id);
    await s.boss.request("/api/active-company", {
      method: "PUT",
      body: JSON.stringify({ companyId: s.company.id }),
    });

    expect((await removal(s)).status).toBe(204);

    for (const bearer of [s.bearer, secondKey.bearer]) {
      const res = await bearer("/api/whoami");
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "This agent was revoked." });
    }
    const listed = await s.owner.request("/api/agents");
    const { agents } = (await listed.json()) as { agents: { revokedAt: string | null }[] };
    expect(agents.map((a) => a.revokedAt)).toEqual([expect.any(String), expect.any(String)]);
    expect(elsewhere.company.name).toBe("Globex");
    expect((await globexKey.bearer("/api/whoami")).status).toBe(200);
  });
});

type Setup = Awaited<ReturnType<typeof setup>>;
