import type { CompanyRole } from "@agentkanban/shared";
import { describe, expect, it } from "vitest";
import { buildTestApp, createCompany, type SignedInUser, type TestApp } from "./harness";

type Team = { id: string; name: string; memberCount: number; myRole: string | null };
type TeamMember = { userId: string; email: string; role: "lead" | "member" };

async function createTeam(user: SignedInUser, name: string) {
  const res = await user.request("/api/teams", { method: "POST", body: JSON.stringify({ name }) });
  return { res, team: ((await res.json()) as { team: Team }).team };
}

function addToTeam(user: SignedInUser, teamId: string, userId: string) {
  return user.request(`/api/teams/${teamId}/members`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

function setTeamRole(user: SignedInUser, teamId: string, userId: string, role: string) {
  return user.request(`/api/teams/${teamId}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

async function teamMembers(user: SignedInUser, teamId: string) {
  const res = await user.request(`/api/teams/${teamId}`);
  return ((await res.json()) as { members: TeamMember[] }).members;
}

/** A Company with an actor of the given Role, a bystander, and one Team. */
async function setup(t: TestApp, actorRole: CompanyRole | "lead") {
  const { owner, members } = await createCompany(t, {
    name: "Acme",
    members: [
      { email: "actor@example.com", role: actorRole === "lead" ? "member" : actorRole },
      { email: "other@example.com", role: "member" },
    ],
  });
  const [actor, other] = members as [SignedInUser, SignedInUser];
  const { team } = await createTeam(owner, "Platform");
  if (actorRole === "lead") {
    await addToTeam(owner, team.id, actor.user.id);
    await setTeamRole(owner, team.id, actor.user.id, "lead");
  }
  return { owner, actor, other, team };
}

describe("Teams", () => {
  describe.each([
    ["owner", true],
    ["admin", true],
    ["lead", false],
    ["member", false],
  ] as const)("as %s", (actorRole, canManage) => {
    it(`${canManage ? "can" : "cannot"} create, rename, and delete Teams`, async () => {
      const t = buildTestApp();
      const { actor, team } = await setup(t, actorRole);

      const created = await createTeam(actor, "Mobile");
      const renamed = await actor.request(`/api/teams/${team.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "Infra" }),
      });
      const deleted = await actor.request(`/api/teams/${team.id}`, { method: "DELETE" });

      expect([created.res.status, renamed.status, deleted.status]).toEqual(
        canManage ? [201, 200, 204] : [403, 403, 403],
      );
    });

    it(`${canManage ? "can" : "cannot"} make a Team member a lead`, async () => {
      const t = buildTestApp();
      const { owner, actor, other, team } = await setup(t, actorRole);
      await addToTeam(owner, team.id, other.user.id);

      const res = await setTeamRole(actor, team.id, other.user.id, "lead");

      expect(res.status).toBe(canManage ? 200 : 403);
    });
  });

  it.each([
    ["owner", 201],
    ["admin", 201],
    ["lead", 201],
    ["member", 403],
  ] as const)("lets a %s add and remove Team members: %i", async (actorRole, status) => {
    const t = buildTestApp();
    const { actor, other, team } = await setup(t, actorRole);

    const add = await addToTeam(actor, team.id, other.user.id);
    expect(add.status).toBe(status);
    if (status !== 201) return;

    const remove = await actor.request(`/api/teams/${team.id}/members/${other.user.id}`, {
      method: "DELETE",
    });
    expect(remove.status).toBe(204);
    expect((await teamMembers(actor, team.id)).map((m) => m.email)).not.toContain(
      "other@example.com",
    );
  });

  it("limits a lead to their own Team", async () => {
    const t = buildTestApp();
    const { owner, actor: lead, other } = await setup(t, "lead");
    const { team: mobile } = await createTeam(owner, "Mobile");

    const res = await addToTeam(lead, mobile.id, other.user.id);

    expect(res.status).toBe(403);
  });

  it("only adds Company members to a Team", async () => {
    const t = buildTestApp();
    const { owner, team } = await setup(t, "admin");
    const { owner: outsider } = await createCompany(t, { name: "Globex" });

    const res = await addToTeam(owner, team.id, outsider.user.id);

    expect(res.status).toBe(404);
    expect((await teamMembers(owner, team.id)).map((m) => m.userId)).not.toContain(
      outsider.user.id,
    );
  });

  it("lets a User belong to several Teams", async () => {
    const t = buildTestApp();
    const { owner, other, team } = await setup(t, "member");
    const { team: mobile } = await createTeam(owner, "Mobile");

    await addToTeam(owner, team.id, other.user.id);
    await addToTeam(owner, mobile.id, other.user.id);

    const res = await other.request("/api/teams");
    expect(await res.json()).toEqual({
      teams: [
        expect.objectContaining({ name: "Mobile", memberCount: 1, myRole: "member" }),
        expect.objectContaining({ name: "Platform", memberCount: 1, myRole: "member" }),
      ],
    });
  });

  it("lets members list Teams and see who is in them", async () => {
    const t = buildTestApp();
    const { owner, actor: member, other, team } = await setup(t, "member");
    await addToTeam(owner, team.id, other.user.id);
    await setTeamRole(owner, team.id, other.user.id, "lead");

    const list = await member.request("/api/teams");
    const detail = await member.request(`/api/teams/${team.id}`);

    expect(await list.json()).toEqual({
      teams: [expect.objectContaining({ id: team.id, name: "Platform", myRole: null })],
    });
    expect(await detail.json()).toMatchObject({
      team: { id: team.id, name: "Platform" },
      members: [{ userId: other.user.id, email: "other@example.com", role: "lead" }],
    });
  });

  it("refuses to add someone twice or name two Teams the same", async () => {
    const t = buildTestApp();
    const { owner, other, team } = await setup(t, "member");
    await addToTeam(owner, team.id, other.user.id);

    const again = await addToTeam(owner, team.id, other.user.id);
    const sameName = await createTeam(owner, "platform");

    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "Already on this team." });
    expect(sameName.res.status).toBe(409);
  });

  it("removes someone from every Team when they leave the Company", async () => {
    const t = buildTestApp();
    const { owner, other, team } = await setup(t, "member");
    const { team: mobile } = await createTeam(owner, "Mobile");
    await addToTeam(owner, team.id, other.user.id);
    await addToTeam(owner, mobile.id, other.user.id);

    await owner.request(`/api/members/${other.user.id}`, { method: "DELETE" });

    expect(await teamMembers(owner, team.id)).toEqual([]);
    expect(await teamMembers(owner, mobile.id)).toEqual([]);
  });

  it("returns not-found for another Company's Team", async () => {
    const t = buildTestApp();
    const { team } = await setup(t, "member");
    const { owner: outsider } = await createCompany(t, { name: "Globex" });

    const read = await outsider.request(`/api/teams/${team.id}`);
    const rename = await outsider.request(`/api/teams/${team.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Mine now" }),
    });
    const add = await addToTeam(outsider, team.id, outsider.user.id);

    expect([read.status, rename.status, add.status]).toEqual([404, 404, 404]);
  });
});
