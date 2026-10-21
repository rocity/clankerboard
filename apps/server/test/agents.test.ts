import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createAgent,
  createApiKey,
  createCompany,
  type SignedInUser,
} from "./harness";

type AgentView = {
  id: string;
  name: string;
  owner: { userId: string; name: string; email: string };
  revokedAt: string | null;
  lastActiveAt: string | null;
};

describe("Agents", () => {
  it("lets any member create an Agent they own", async () => {
    const t = buildTestApp();
    const { members } = await createCompany(t, {
      name: "Acme",
      members: [{ email: "bob@example.com", role: "member" }],
    });
    const bob = members[0] as SignedInUser;

    const res = await bob.request("/api/agents", {
      method: "POST",
      body: JSON.stringify({ name: "Claude-Code-Agent-1" }),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      agent: {
        name: "Claude-Code-Agent-1",
        owner: { userId: bob.user.id, email: "bob@example.com" },
        revokedAt: null,
      },
    });
  });

  it("keeps Agent names unique within a Company", async () => {
    const t = buildTestApp();
    const acme = await createCompany(t, {
      name: "Acme",
      members: [{ email: "bob@example.com", role: "member" }],
    });
    const globex = await createCompany(t, { name: "Globex" });
    await createAgent(acme.owner, "Claude-1");

    const clash = await (acme.members[0] as SignedInUser).request("/api/agents", {
      method: "POST",
      body: JSON.stringify({ name: "claude-1" }),
    });
    const elsewhere = await globex.owner.request("/api/agents", {
      method: "POST",
      body: JSON.stringify({ name: "Claude-1" }),
    });

    expect(clash.status).toBe(409);
    expect(await clash.json()).toEqual({ error: "An agent with that name already exists." });
    expect(elsewhere.status).toBe(201);
  });

  it("shows members their own Agents and owners and admins every Agent", async () => {
    const t = buildTestApp();
    const { owner, members } = await createCompany(t, {
      name: "Acme",
      members: [
        { email: "ada@example.com", role: "admin" },
        { email: "bob@example.com", role: "member" },
      ],
    });
    const [ada, bob] = members as [SignedInUser, SignedInUser];
    await createAgent(owner, "Owner-Agent");
    await createAgent(bob, "Bob-Agent");

    const names = async (user: SignedInUser) => {
      const res = await user.request("/api/agents");
      return ((await res.json()) as { agents: AgentView[] }).agents.map(
        (a) => `${a.name}:${a.owner.email}`,
      );
    };

    expect(await names(bob)).toEqual(["Bob-Agent:bob@example.com"]);
    expect(await names(ada)).toEqual([
      "Bob-Agent:bob@example.com",
      `Owner-Agent:${owner.user.email}`,
    ]);
    expect(await names(owner)).toHaveLength(2);
  });

  it("lets the owner rename their Agent", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });
    const agent = await createAgent(owner, "Claude-1");

    const res = await owner.request(`/api/agents/${agent.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Claude-Reviewer" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ agent: { name: "Claude-Reviewer" } });
  });

  it.each([
    ["the owner", "owner", 200],
    ["an admin", "admin", 200],
    ["another member", "member", 404],
  ] as const)("lets %s revoke an Agent", async (_who, revoker, status) => {
    const t = buildTestApp();
    const { members } = await createCompany(t, {
      name: "Acme",
      members: [
        { email: "bob@example.com", role: "member" },
        { email: "ada@example.com", role: "admin" },
        { email: "cy@example.com", role: "member" },
      ],
    });
    const [bob, ada, cy] = members as [SignedInUser, SignedInUser, SignedInUser];
    const agent = await createAgent(bob, "Bob-Agent");
    const actor = { owner: bob, admin: ada, member: cy }[revoker];

    const res = await actor.request(`/api/agents/${agent.id}/revoke`, { method: "POST" });

    expect(res.status).toBe(status);
    if (status === 200) {
      expect(await res.json()).toMatchObject({ agent: { revokedAt: expect.any(String) } });
    }
  });
});

describe("API Keys", () => {
  it("returns the full key once and lists only safe fields", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });
    const agent = await createAgent(owner, "Claude-1");

    const res = await owner.request(`/api/agents/${agent.id}/keys`, {
      method: "POST",
      body: JSON.stringify({ label: "laptop" }),
    });
    const { key, secret } = (await res.json()) as {
      key: { id: string; prefix: string };
      secret: string;
    };

    expect(res.status).toBe(201);
    expect(secret).toMatch(/^cb_[A-Za-z0-9_-]{40,}$/);
    expect(secret.startsWith(key.prefix)).toBe(true);
    const list = await owner.request(`/api/agents/${agent.id}/keys`);
    const text = await list.text();
    expect(text).not.toContain(secret);
    expect(JSON.parse(text)).toEqual({
      keys: [
        {
          id: key.id,
          label: "laptop",
          prefix: key.prefix,
          createdAt: expect.any(String),
          lastUsedAt: null,
          revokedAt: null,
        },
      ],
    });
  });

  it("acts as the Agent on a bearer request", async () => {
    const t = buildTestApp();
    const { company, owner } = await createCompany(t, { name: "Acme" });
    const agent = await createAgent(owner, "Claude-1");
    const { bearer } = await createApiKey(t, owner, agent.id);

    const res = await bearer("/api/whoami");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      actor: { type: "agent", id: agent.id, name: "Claude-1" },
      owner: { userId: owner.user.id, name: owner.user.name, email: owner.user.email },
      company: { id: company.id, name: "Acme", role: "owner" },
    });
  });

  it("reports the signed-in User on a session request", async () => {
    const t = buildTestApp();
    const { company, owner } = await createCompany(t, { name: "Acme" });

    const res = await owner.request("/api/whoami");

    expect(await res.json()).toEqual({
      actor: { type: "user", id: owner.user.id, name: owner.user.name },
      owner: null,
      company: { id: company.id, name: "Acme", role: "owner" },
    });
  });

  it("lets an Agent hold several keys and kills only the revoked one", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });
    const agent = await createAgent(owner, "Claude-1");
    const first = await createApiKey(t, owner, agent.id, "old");
    const second = await createApiKey(t, owner, agent.id, "new");
    expect((await first.bearer("/api/whoami")).status).toBe(200);
    expect((await second.bearer("/api/whoami")).status).toBe(200);

    const revoke = await owner.request(`/api/agents/${agent.id}/keys/${first.key.id}/revoke`, {
      method: "POST",
    });

    expect(revoke.status).toBe(200);
    const dead = await first.bearer("/api/whoami");
    expect(dead.status).toBe(401);
    expect(await dead.json()).toEqual({ error: "This API key was revoked." });
    expect((await second.bearer("/api/whoami")).status).toBe(200);
  });

  it("stops every key when the Agent is revoked", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });
    const agent = await createAgent(owner, "Claude-1");
    const first = await createApiKey(t, owner, agent.id);
    const second = await createApiKey(t, owner, agent.id);

    await owner.request(`/api/agents/${agent.id}/revoke`, { method: "POST" });

    for (const { bearer } of [first, second]) {
      const res = await bearer("/api/whoami");
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "This agent was revoked." });
    }
    const create = await owner.request(`/api/agents/${agent.id}/keys`, {
      method: "POST",
      body: JSON.stringify({ label: "again" }),
    });
    expect(create.status).toBe(409);
  });

  it.each([
    ["no credentials", undefined, "Sign in first."],
    ["a non-bearer scheme", "Basic YWxhZGRpbjpvcGVu", "That API key is not valid."],
    ["a key without the prefix", "Bearer abc123", "That API key is not valid."],
    ["an unknown key", `Bearer cb_${"x".repeat(43)}`, "That API key is not valid."],
  ])("rejects %s with 401", async (_case, authorization, error) => {
    const t = buildTestApp();
    await createCompany(t, { name: "Acme" });

    const res = await t.app.request("http://localhost:3000/api/whoami", {
      headers: authorization ? { authorization } : {},
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error });
  });

  it("returns not-found for another Company's resources", async () => {
    const t = buildTestApp();
    const acme = await createCompany(t, { name: "Acme" });
    const globex = await createCompany(t, { name: "Globex" });
    const team = await globex.owner.request("/api/teams", {
      method: "POST",
      body: JSON.stringify({ name: "Platform" }),
    });
    const { team: globexTeam } = (await team.json()) as { team: { id: string } };
    const globexAgent = await createAgent(globex.owner, "Globex-Agent");
    const agent = await createAgent(acme.owner, "Acme-Agent");
    const { bearer } = await createApiKey(t, acme.owner, agent.id);

    expect((await bearer(`/api/teams/${globexTeam.id}`)).status).toBe(404);
    expect((await acme.owner.request(`/api/agents/${globexAgent.id}/keys`)).status).toBe(404);
  });

  it("refuses human-only routes to an Agent", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });
    const agent = await createAgent(owner, "Claude-1");
    const { bearer } = await createApiKey(t, owner, agent.id);

    const res = await bearer("/api/companies", {
      method: "POST",
      body: JSON.stringify({ name: "Agent Corp" }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Agents can't do this." });
  });
});
