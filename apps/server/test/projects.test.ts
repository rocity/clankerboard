import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  CapturingEventBus,
  createAgent,
  createApiKey,
  createCompany,
  type Fetch,
  type SignedInUser,
  type TestApp,
} from "./harness";

type Project = { key: string; name: string; team: { id: string; name: string } | null };

async function createProject(as: Fetch, body: { name: string; key: string; teamId?: string }) {
  const res = await as("/api/projects", { method: "POST", body: JSON.stringify(body) });
  return { res, body: (await res.json()) as { project: Project; error?: string } };
}

async function createTeam(user: SignedInUser, name: string) {
  const res = await user.request("/api/teams", { method: "POST", body: JSON.stringify({ name }) });
  return ((await res.json()) as { team: { id: string; name: string } }).team;
}

/** Acme with an owner, an admin, a member, and the owner's Agent. */
async function setup(t: TestApp) {
  const { owner, members } = await createCompany(t, {
    name: "Acme",
    members: [
      { email: "ada@example.com", role: "admin" },
      { email: "bob@example.com", role: "member" },
    ],
  });
  const [admin, member] = members as [SignedInUser, SignedInUser];
  const agent = await createAgent(owner, "Claude-1");
  const { bearer } = await createApiKey(t, owner, agent.id);
  return { owner, admin, member, bearer };
}

describe("Projects", () => {
  it.each(["session", "bearer"] as const)("can be created by a %s caller", async (caller) => {
    const t = buildTestApp();
    const { member, bearer } = await setup(t);

    const { res, body } = await createProject(caller === "session" ? member.request : bearer, {
      name: "Clankerboard",
      key: "CB",
    });

    expect(res.status).toBe(201);
    expect(body.project).toMatchObject({ key: "CB", name: "Clankerboard", team: null });
  });

  it.each(["cb", "C", "TOOLONGKEYXX", "C1", "C-B"])("rejects the Project Key %s", async (key) => {
    const t = buildTestApp();
    const { member } = await setup(t);

    const { res, body } = await createProject(member.request, { name: "X", key });

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "Project keys are 2 to 10 uppercase letters." });
  });

  it("keeps Project Keys unique per Company", async () => {
    const t = buildTestApp();
    const { member } = await setup(t);
    const globex = await createCompany(t, { name: "Globex" });
    await createProject(member.request, { name: "One", key: "CB" });

    const clash = await createProject(member.request, { name: "Two", key: "CB" });
    const elsewhere = await createProject(globex.owner.request, { name: "Three", key: "CB" });

    expect(clash.res.status).toBe(409);
    expect(clash.body).toEqual({ error: "That project key is taken." });
    expect(elsewhere.res.status).toBe(201);
  });

  it("never changes a Project Key", async () => {
    const t = buildTestApp();
    const { member } = await setup(t);
    await createProject(member.request, { name: "One", key: "CB" });

    const res = await member.request("/api/projects/CB", {
      method: "PATCH",
      body: JSON.stringify({ key: "XY" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "A project key can't be changed." });
    expect((await member.request("/api/projects/CB")).status).toBe(200);
  });

  it("is renamed and moved between Teams, by a User or an Agent", async () => {
    const t = buildTestApp();
    const { owner, member, bearer } = await setup(t);
    const platform = await createTeam(owner, "Platform");
    await createProject(member.request, { name: "One", key: "CB" });

    const renamed = await member.request("/api/projects/CB", {
      method: "PATCH",
      body: JSON.stringify({ name: "Board", teamId: platform.id }),
    });
    expect(await renamed.json()).toMatchObject({
      project: { name: "Board", team: { id: platform.id, name: "Platform" } },
    });

    const cleared = await bearer("/api/projects/CB", {
      method: "PATCH",
      body: JSON.stringify({ teamId: null }),
    });
    expect(await cleared.json()).toMatchObject({ project: { name: "Board", team: null } });
  });

  it("only takes a Team from the same Company", async () => {
    const t = buildTestApp();
    const { member } = await setup(t);
    const globex = await createCompany(t, { name: "Globex" });
    const foreign = await createTeam(globex.owner, "Theirs");

    const { res } = await createProject(member.request, {
      name: "One",
      key: "CB",
      teamId: foreign.id,
    });

    expect(res.status).toBe(404);
  });

  it("lists Projects, filtered by Team", async () => {
    const t = buildTestApp();
    const { owner, member } = await setup(t);
    const platform = await createTeam(owner, "Platform");
    await createProject(member.request, { name: "Board", key: "CB", teamId: platform.id });
    await createProject(member.request, { name: "Mobile", key: "MOB" });

    const all = await member.request("/api/projects");
    const filtered = await member.request(`/api/projects?teamId=${platform.id}`);

    const keys = async (res: Response) =>
      ((await res.json()) as { projects: Project[] }).projects.map((p) => p.key);
    expect(await keys(all)).toEqual(["CB", "MOB"]);
    expect(await keys(filtered)).toEqual(["CB"]);
  });

  it("returns not-found for another Company's Project", async () => {
    const t = buildTestApp();
    const { member } = await setup(t);
    const globex = await createCompany(t, { name: "Globex" });
    await createProject(globex.owner.request, { name: "Theirs", key: "GX" });

    expect((await member.request("/api/projects/GX")).status).toBe(404);
    const patch = await member.request("/api/projects/GX", {
      method: "PATCH",
      body: JSON.stringify({ name: "Mine" }),
    });
    expect(patch.status).toBe(404);
  });

  it("records creating, changing, and deleting a Project as Activity", async () => {
    const events = new CapturingEventBus();
    const t = buildTestApp({ deps: { events } });
    const { owner, bearer } = await setup(t);

    await createProject(bearer, { name: "One", key: "CB" });
    await owner.request("/api/projects/CB", {
      method: "PATCH",
      body: JSON.stringify({ name: "Board" }),
    });
    await owner.request("/api/projects/CB", { method: "DELETE" });

    expect(events.published.map((e) => [e.kind, e.actor.type, e.payload])).toEqual([
      ["project.created", "agent", { key: "CB", name: "One", teamId: null }],
      ["project.updated", "user", { changes: { name: { from: "One", to: "Board" } } }],
      ["project.deleted", "user", { key: "CB" }],
    ]);
  });

  it.each([
    ["owner", 204],
    ["admin", 204],
    ["member", 403],
    ["agent", 403],
  ] as const)("lets a %s hard-delete a Project: %i", async (who, status) => {
    const t = buildTestApp();
    const s = await setup(t);
    await createProject(s.member.request, { name: "One", key: "CB" });
    const as = who === "agent" ? s.bearer : s[who].request;

    const res = await as("/api/projects/CB", { method: "DELETE" });

    expect(res.status).toBe(status);
    if (who === "agent") {
      expect(await res.json()).toEqual({ error: "Agents can't delete anything." });
    }
    expect((await s.member.request("/api/projects/CB")).status).toBe(status === 204 ? 404 : 200);
  });
});
