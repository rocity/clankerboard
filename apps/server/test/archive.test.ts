import { describe, expect, it } from "vitest";
import {
  activityOf,
  buildTestApp,
  CapturingEventBus,
  createAgent,
  createApiKey,
  createCompany,
  createProject,
  createTicket,
  type Fetch,
  type SignedInUser,
  type TestApp,
} from "./harness";

const post = (as: Fetch, path: string, body?: object) =>
  as(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });

const kinds = activityOf;

/** CB with Epic CB-1, its Stories CB-2 and CB-3, and a loose Task CB-4. */
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
  await createProject(owner.request, { name: "Board", key: "CB" });
  await createTicket(owner.request, { projectKey: "CB", title: "Epic", type: "epic" });
  for (const title of ["S1", "S2"]) {
    await createTicket(owner.request, {
      projectKey: "CB",
      title,
      type: "story",
      parentKey: "CB-1",
    });
  }
  await createTicket(owner.request, { projectKey: "CB", title: "Loose" });
  return { owner, admin, member, bearer };
}

describe("Archive and restore", () => {
  it("archives a Ticket, detaching its children and recording each detachment", async () => {
    const t = buildTestApp();
    const { member } = await setup(t);

    const res = await post(member.request, "/api/tickets/CB-1/archive");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ticket: { archivedAt: t.clock.now().toISOString() } });
    for (const child of ["CB-2", "CB-3"]) {
      const ticket = await (await member.request(`/api/tickets/${child}`)).json();
      expect(ticket).toMatchObject({ ticket: { parent: null, archivedAt: null } });
      expect((await kinds(member.request, child)).at(-1)).toMatchObject({
        kind: "ticket.detached",
        payload: { parent: "CB-1" },
      });
    }
    expect((await kinds(member.request, "CB-1")).at(-1)).toMatchObject({
      kind: "ticket.archived",
      payload: { detached: ["CB-2", "CB-3"] },
    });
  });

  it("hides archived Tickets from the board and brings them back on restore", async () => {
    const t = buildTestApp();
    const { member } = await setup(t);
    await post(member.request, "/api/tickets/CB-4/archive");
    const board = async () => {
      const res = await member.request("/api/tickets?projectKey=CB");
      return ((await res.json()) as { tickets: { key: string }[] }).tickets.map((x) => x.key);
    };
    expect(await board()).not.toContain("CB-4");

    const res = await post(member.request, "/api/tickets/CB-4/restore");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ticket: { archivedAt: null } });
    expect(await board()).toContain("CB-4");
    expect((await kinds(member.request, "CB-4")).at(-1)?.kind).toBe("ticket.restored");
  });

  it("does not re-attach children on restore", async () => {
    const t = buildTestApp();
    const { member } = await setup(t);
    await post(member.request, "/api/tickets/CB-1/archive");

    await post(member.request, "/api/tickets/CB-1/restore");

    const res = await member.request("/api/tickets/CB-1/children");
    expect(await res.json()).toEqual({ children: [] });
  });

  it("refuses to move, claim, or assign an archived Ticket", async () => {
    const t = buildTestApp();
    const { member } = await setup(t);
    await post(member.request, "/api/tickets/CB-4/archive");

    const moved = await post(member.request, "/api/tickets/CB-4/move", { status: "todo" });
    const claimed = await post(member.request, "/api/tickets/CB-4/claim");
    const assigned = await post(member.request, "/api/tickets/CB-4/assign", {
      assignee: { type: "user", id: member.user.id },
    });

    expect([moved.status, claimed.status, assigned.status]).toEqual([409, 409, 409]);
    expect(await moved.json()).toEqual({ error: "Archived tickets can't be moved." });
    expect(await claimed.json()).toEqual({ error: "Archived tickets can't be claimed." });
    expect(await assigned.json()).toEqual({ error: "Archived tickets can't be assigned." });
  });

  it("says plainly when there is nothing to archive or restore", async () => {
    const t = buildTestApp();
    const { member } = await setup(t);

    const restore = await post(member.request, "/api/tickets/CB-4/restore");
    await post(member.request, "/api/tickets/CB-4/archive");
    const again = await post(member.request, "/api/tickets/CB-4/archive");

    expect(await restore.json()).toEqual({ error: "This ticket isn't archived." });
    expect(await again.json()).toEqual({ error: "This ticket is already archived." });
  });

  it("refuses an archived Ticket as a Parent", async () => {
    const t = buildTestApp();
    const { member } = await setup(t);
    await post(member.request, "/api/tickets/CB-1/archive");

    const res = await member.request("/api/tickets", {
      method: "POST",
      body: JSON.stringify({ projectKey: "CB", title: "S", type: "story", parentKey: "CB-1" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Restore CB-1 before adding tickets under it." });
  });
});

describe("Hard delete", () => {
  it.each([
    ["owner", 204],
    ["admin", 204],
    ["member", 403],
  ] as const)("is allowed for a %s User: %i", async (who, status) => {
    const t = buildTestApp();
    const s = await setup(t);

    const res = await s[who].request("/api/tickets/CB-4", { method: "DELETE" });

    expect(res.status).toBe(status);
    expect((await s.member.request("/api/tickets/CB-4")).status).toBe(status === 204 ? 404 : 200);
  });

  it("records the deletion without keeping any of the purged content", async () => {
    const events = new CapturingEventBus();
    const t = buildTestApp({ deps: { events } });
    const { owner } = await setup(t);
    await owner.request("/api/tickets/CB-4", {
      method: "PATCH",
      body: JSON.stringify({ title: "Leaked customer password", description: "hunter2" }),
    });

    await owner.request("/api/tickets/CB-4", { method: "DELETE" });

    const deleted = events.published.at(-1);
    expect(deleted).toMatchObject({ kind: "ticket.deleted", ticketId: null, ticketKey: "CB-4" });
    expect(deleted?.payload).toEqual({ ticketKey: "CB-4" });
  });

  it("removes Comments and Activity, detaches children, and never reuses the number", async () => {
    const t = buildTestApp();
    const { owner, member } = await setup(t);
    await post(member.request, "/api/tickets/CB-1/comments", { body: "Sensitive." });

    await owner.request("/api/tickets/CB-1", { method: "DELETE" });

    expect((await member.request("/api/tickets/CB-1/timeline")).status).toBe(404);
    expect(await (await member.request("/api/tickets/CB-2")).json()).toMatchObject({
      ticket: { parent: null },
    });
    expect((await kinds(member.request, "CB-2")).at(-1)?.kind).toBe("ticket.detached");
    const next = await createTicket(member.request, { projectKey: "CB", title: "After" });
    expect(next.key).toBe("CB-5");
    expect((await member.request("/api/tickets/CB-1")).status).toBe(404);
  });
});

describe("Agents", () => {
  it.each([
    ["archive", "POST", "/api/tickets/CB-4/archive", "Agents can't archive or restore tickets."],
    ["restore", "POST", "/api/tickets/CB-4/restore", "Agents can't archive or restore tickets."],
    ["hard-delete", "DELETE", "/api/tickets/CB-4", "Agents can't delete anything."],
  ])("cannot %s, even for an owner", async (_action, method, path, error) => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t);
    if (path.endsWith("restore")) await post(owner.request, "/api/tickets/CB-4/archive");

    const res = await bearer(path, { method });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error });
  });
});
