import type { CompanyRole } from "@agentkanban/shared";
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger";
import { buildTestApp, createCompany, type SignedInUser } from "./harness";

type Member = { userId: string; email: string; name: string; role: CompanyRole };

async function membersOf(user: SignedInUser) {
  const res = await user.request("/api/members");
  return ((await res.json()) as { members: Member[] }).members;
}

const roles: CompanyRole[] = ["owner", "admin", "member"];

describe("Memberships", () => {
  it("lists every member with their Role", async () => {
    const t = buildTestApp();
    const { owner, members } = await createCompany(t, {
      name: "Acme",
      members: [
        { email: "ada@example.com", role: "admin" },
        { email: "bob@example.com", role: "member" },
      ],
    });

    const res = await (members[1] as SignedInUser).request("/api/members");

    expect(res.status).toBe(200);
    const list = ((await res.json()) as { members: Member[] }).members;
    expect(list.map((m) => [m.email, m.role])).toEqual([
      [owner.user.email, "owner"],
      ["ada@example.com", "admin"],
      ["bob@example.com", "member"],
    ]);
    expect(list[1]).toMatchObject({ userId: members[0]?.user.id, name: "ada" });
  });

  it("returns not-found for a User outside the Company", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });
    const { owner: outsider } = await createCompany(t, { name: "Globex" });

    const change = await owner.request(`/api/members/${outsider.user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ role: "admin" }),
    });
    const remove = await owner.request(`/api/members/${outsider.user.id}`, { method: "DELETE" });

    expect(change.status).toBe(404);
    expect(remove.status).toBe(404);
  });

  it("cuts off a removed member's access immediately", async () => {
    const t = buildTestApp();
    const { owner, members } = await createCompany(t, {
      name: "Acme",
      members: [{ email: "bob@example.com", role: "member" }],
    });
    const bob = members[0] as SignedInUser;

    const res = await owner.request(`/api/members/${bob.user.id}`, { method: "DELETE" });

    expect(res.status).toBe(204);
    expect((await bob.request("/api/company")).status).toBe(400);
    expect(await (await bob.request("/api/companies")).json()).toMatchObject({ companies: [] });
    expect((await membersOf(owner)).map((m) => m.email)).not.toContain("bob@example.com");
  });

  describe("permission matrix", () => {
    type Case = [actor: CompanyRole, action: string, target: CompanyRole | null, status: number];

    const changeRole: Case[] = roles.flatMap((actor) =>
      roles.flatMap((target) =>
        roles
          .filter((to) => to !== target)
          .map((to): Case => {
            const allowed =
              actor === "owner" || (actor === "admin" && target !== "owner" && to !== "owner");
            return [actor, `change role to ${to}`, target, allowed ? 200 : 403];
          }),
      ),
    );
    const remove: Case[] = roles.flatMap((actor) =>
      roles.map((target): Case => {
        const allowed = actor === "owner" || (actor === "admin" && target !== "owner");
        return [actor, "remove", target, allowed ? 204 : 403];
      }),
    );
    const own: Case[] = roles.flatMap((actor): Case[] => [
      [actor, "list members", null, 200],
      [actor, "leave", null, 204],
      [actor, "rename company", null, actor === "member" ? 403 : 200],
    ]);

    it.each([...changeRole, ...remove, ...own])(
      "%s: %s (target %s) -> %i",
      async (actorRole, action, targetRole, status) => {
        const t = buildTestApp();
        // A separate owner keeps last-owner protection out of the way.
        const { members } = await createCompany(t, {
          name: "Acme",
          members: [
            { email: "actor@example.com", role: actorRole },
            ...(targetRole ? [{ email: "target@example.com", role: targetRole }] : []),
          ],
        });
        const [actor, target] = members as [SignedInUser, SignedInUser | undefined];
        const targetPath = `/api/members/${target?.user.id}`;

        let res: Response;
        if (action.startsWith("change role to ")) {
          res = await actor.request(targetPath, {
            method: "PATCH",
            body: JSON.stringify({ role: action.replace("change role to ", "") }),
          });
        } else if (action === "remove") {
          res = await actor.request(targetPath, { method: "DELETE" });
        } else if (action === "leave") {
          res = await actor.request(`/api/members/${actor.user.id}`, { method: "DELETE" });
        } else if (action === "list members") {
          res = await actor.request("/api/members");
        } else {
          res = await actor.request("/api/company", {
            method: "PATCH",
            body: JSON.stringify({ name: "Renamed" }),
          });
        }

        expect(res.status).toBe(status);
      },
    );
  });

  it("shows the new Role after a change", async () => {
    const t = buildTestApp();
    const { owner, members } = await createCompany(t, {
      name: "Acme",
      members: [{ email: "bob@example.com", role: "member" }],
    });
    const bob = members[0] as SignedInUser;

    const res = await owner.request(`/api/members/${bob.user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ role: "admin" }),
    });

    expect(await res.json()).toMatchObject({ member: { email: "bob@example.com", role: "admin" } });
    expect((await membersOf(owner)).find((m) => m.email === "bob@example.com")?.role).toBe("admin");
  });

  it("explains a refused change in plain words", async () => {
    const t = buildTestApp();
    const { owner, members } = await createCompany(t, {
      name: "Acme",
      members: [{ email: "ada@example.com", role: "admin" }],
    });
    const ada = members[0] as SignedInUser;

    const res = await ada.request(`/api/members/${owner.user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ role: "member" }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only an owner can change an owner's role." });
  });

  describe("last owner", () => {
    it("cannot leave", async () => {
      const t = buildTestApp();
      const { owner } = await createCompany(t, { name: "Acme" });

      const res = await owner.request(`/api/members/${owner.user.id}`, { method: "DELETE" });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "A company needs at least one owner." });
      expect((await owner.request("/api/company")).status).toBe(200);
    });

    it("cannot demote themselves", async () => {
      const t = buildTestApp();
      const { owner } = await createCompany(t, { name: "Acme" });

      const res = await owner.request(`/api/members/${owner.user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: "admin" }),
      });

      expect(res.status).toBe(409);
      expect((await membersOf(owner))[0]?.role).toBe("owner");
    });

    it("can step down once another owner exists", async () => {
      const t = buildTestApp();
      const { owner } = await createCompany(t, {
        name: "Acme",
        members: [{ email: "co@example.com", role: "owner" }],
      });

      const demote = await owner.request(`/api/members/${owner.user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: "member" }),
      });

      expect(demote.status).toBe(200);
    });
  });

  describe("member-removed hook", () => {
    it("runs for removals and for members leaving", async () => {
      const events: { companyId: string; userId: string }[] = [];
      const t = buildTestApp({
        deps: { hooks: { memberRemoved: [async (_tx, event) => void events.push(event)] } },
      });
      const { company, owner, members } = await createCompany(t, {
        name: "Acme",
        members: [
          { email: "bob@example.com", role: "member" },
          { email: "cy@example.com", role: "member" },
        ],
      });
      const [bob, cy] = members as [SignedInUser, SignedInUser];

      await owner.request(`/api/members/${bob.user.id}`, { method: "DELETE" });
      await cy.request(`/api/members/${cy.user.id}`, { method: "DELETE" });

      expect(events).toEqual([
        { companyId: company.id, userId: bob.user.id },
        { companyId: company.id, userId: cy.user.id },
      ]);
    });

    it("runs in the same transaction as the removal", async () => {
      const t = buildTestApp({
        deps: {
          // The 500 below is the point of the test; keep its log out of the output.
          logger: createLogger("silent"),
          hooks: {
            memberRemoved: [
              async () => {
                throw new Error("revocation failed");
              },
            ],
          },
        },
      });
      const { owner, members } = await createCompany(t, {
        name: "Acme",
        members: [{ email: "bob@example.com", role: "member" }],
      });
      const bob = members[0] as SignedInUser;

      const res = await owner.request(`/api/members/${bob.user.id}`, { method: "DELETE" });

      expect(res.status).toBe(500);
      expect((await membersOf(owner)).map((m) => m.email)).toContain("bob@example.com");
      expect((await bob.request("/api/company")).status).toBe(200);
    });
  });
});
