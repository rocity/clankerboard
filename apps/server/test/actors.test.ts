import type { CompanyRole } from "@agentkanban/shared";
import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createAgent,
  createApiKey,
  createCompany,
  type SignedInUser,
} from "./harness";

type ActorRow = { type: "user" | "agent"; id: string; name: string; revoked: boolean };

async function actorsFor(as: SignedInUser["request"]) {
  const res = await as("/api/actors");
  return { status: res.status, body: (await res.json()) as { actors: ActorRow[] } };
}

const roles: CompanyRole[] = ["owner", "admin", "member"];

describe("Actors", () => {
  it("lists the Users and every Agent of the Company, by name and kind only", async () => {
    const t = buildTestApp();
    const { owner, members } = await createCompany(t, {
      name: "Acme",
      members: [{ email: "bob@example.com", role: "member" }],
    });
    const bob = members[0] as SignedInUser;
    const ownerAgent = await createAgent(owner, "Zed-Agent");
    const bobAgent = await createAgent(bob, "Bob-Agent");

    const { status, body } = await actorsFor(bob.request);

    expect(status).toBe(200);
    expect(body.actors).toEqual([
      { type: "user", id: bob.user.id, name: "bob", revoked: false },
      { type: "user", id: owner.user.id, name: owner.user.name, revoked: false },
      { type: "agent", id: bobAgent.id, name: "Bob-Agent", revoked: false },
      { type: "agent", id: ownerAgent.id, name: "Zed-Agent", revoked: false },
    ]);
  });

  it.each(roles)("lets a %s read the list", async (role) => {
    const t = buildTestApp();
    const { owner, members } = await createCompany(t, {
      name: "Acme",
      members: [{ email: "pat@example.com", role }],
    });
    await createAgent(owner, "Claude-1");

    const { status, body } = await actorsFor((members[0] as SignedInUser).request);

    expect(status).toBe(200);
    expect(body.actors.map((a) => a.name)).toEqual(
      expect.arrayContaining(["pat", owner.user.name, "Claude-1"]),
    );
  });

  it("lets an Agent read the list", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });
    const agent = await createAgent(owner, "Claude-1");
    const { bearer } = await createApiKey(t, owner, agent.id);

    const { status, body } = await actorsFor(bearer);

    expect(status).toBe(200);
    expect(body.actors.map((a) => a.id)).toContain(agent.id);
  });

  it("keeps a revoked Agent in the list, marked revoked", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });
    const agent = await createAgent(owner, "Old-Agent");
    await owner.request(`/api/agents/${agent.id}/revoke`, { method: "POST" });

    const { body } = await actorsFor(owner.request);

    expect(body.actors.find((a) => a.id === agent.id)).toMatchObject({
      name: "Old-Agent",
      revoked: true,
    });
  });

  it("leaves out Users who were removed and anyone from another Company", async () => {
    const t = buildTestApp();
    const acme = await createCompany(t, {
      name: "Acme",
      members: [{ email: "gone@example.com", role: "member" }],
    });
    const globex = await createCompany(t, { name: "Globex" });
    await createAgent(globex.owner, "Globex-Agent");
    const gone = acme.members[0] as SignedInUser;
    await acme.owner.request(`/api/members/${gone.user.id}`, { method: "DELETE" });

    const { body } = await actorsFor(acme.owner.request);

    expect(body.actors.map((a) => a.name)).toEqual([acme.owner.user.name]);
  });

  it("is closed to anyone signed out", async () => {
    const t = buildTestApp();

    const res = await t.request("/api/actors");

    expect(res.status).toBe(401);
  });

  it("does not include email addresses", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });

    const res = await owner.request("/api/actors");

    expect(await res.text()).not.toContain(owner.user.email);
  });
});
