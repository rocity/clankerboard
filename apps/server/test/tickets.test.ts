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
  type TestApp,
} from "./harness";

async function setup(t: TestApp) {
  const { owner } = await createCompany(t, { name: "Acme" });
  const agent = await createAgent(owner, "Claude-1");
  const { bearer } = await createApiKey(t, owner, agent.id);
  await createProject(owner.request, { name: "Board", key: "CB" });
  return { owner, agent, bearer };
}

describe("Tickets", () => {
  it("gives Ticket Keys that increase per Project", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await createProject(owner.request, { name: "Mobile", key: "MOB" });

    const keys = [
      (await createTicket(owner.request, { projectKey: "CB", title: "One" })).key,
      (await createTicket(owner.request, { projectKey: "CB", title: "Two" })).key,
      (await createTicket(owner.request, { projectKey: "MOB", title: "Three" })).key,
    ];

    expect(keys).toEqual(["CB-1", "CB-2", "MOB-1"]);
  });

  it("allocates Ticket Keys atomically under concurrent creates", async () => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t);

    const created = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createTicket(i % 2 ? owner.request : bearer, { projectKey: "CB", title: `T${i}` }),
      ),
    );

    expect(created.map((ticket) => ticket.number).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it("defaults to Backlog and medium priority and returns creator and timestamps by key", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await createTicket(owner.request, {
      projectKey: "CB",
      title: "Fix login",
      description: "It **breaks**",
      type: "bug",
    });

    const res = await owner.request("/api/tickets/CB-1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ticket: expect.objectContaining({
        key: "CB-1",
        title: "Fix login",
        description: "It **breaks**",
        type: "bug",
        status: "backlog",
        priority: "medium",
        assignee: null,
        archivedAt: null,
        createdBy: { type: "user", id: owner.user.id, name: owner.user.name, revoked: false },
        createdAt: t.clock.now().toISOString(),
        updatedAt: t.clock.now().toISOString(),
      }),
    });
  });

  it("credits an Agent as the creator of its Tickets", async () => {
    const t = buildTestApp();
    const { agent, bearer } = await setup(t);

    const ticket = await createTicket(bearer, { projectKey: "CB", title: "From the agent" });

    expect(ticket.createdBy).toEqual({
      type: "agent",
      id: agent.id,
      name: "Claude-1",
      revoked: false,
    });
  });

  it("records edits as Activity with field diffs, credited to the acting Actor", async () => {
    const t = buildTestApp();
    const { owner, agent, bearer } = await setup(t);
    await createTicket(owner.request, { projectKey: "CB", title: "Draft" });

    const res = await bearer("/api/tickets/CB-1", {
      method: "PATCH",
      body: JSON.stringify({ title: "Final", priority: "high", description: "" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ticket: { title: "Final", priority: "high" } });

    const activity = await activityOf(owner.request, "CB-1");
    expect(activity).toEqual([
      expect.objectContaining({
        kind: "ticket.created",
        actor: expect.objectContaining({ type: "user", id: owner.user.id }),
      }),
      expect.objectContaining({
        kind: "ticket.updated",
        actor: expect.objectContaining({ type: "agent", id: agent.id }),
        payload: {
          changes: {
            title: { from: "Draft", to: "Final" },
            priority: { from: "medium", to: "high" },
          },
        },
      }),
    ]);
    expect(activity[1]?.id).toBeGreaterThan(activity[0]?.id ?? Infinity);
  });

  it("records nothing for an edit that changes nothing", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await createTicket(owner.request, { projectKey: "CB", title: "Same" });

    await owner.request("/api/tickets/CB-1", {
      method: "PATCH",
      body: JSON.stringify({ title: "Same" }),
    });

    expect((await activityOf(owner.request, "CB-1")).map((a) => a.kind)).toEqual([
      "ticket.created",
    ]);
  });

  it("publishes each Activity to the event bus after it is stored", async () => {
    const events = new CapturingEventBus();
    const t = buildTestApp({ deps: { events } });
    const { owner } = await setup(t);
    // Another request sees the change only once its transaction committed.
    events.probe = async (event) => {
      const stored = await activityOf(owner.request, event.ticketKey ?? "");
      return stored.some((activity) => activity.id === event.id);
    };
    await createTicket(owner.request, { projectKey: "CB", title: "One" });
    await owner.request("/api/tickets/CB-1", {
      method: "PATCH",
      body: JSON.stringify({ title: "Two" }),
    });

    const stored = await activityOf(owner.request, "CB-1");

    const published = events.published.filter((a) => a.ticketKey === "CB-1");
    expect(published.map((a) => [a.id, a.kind])).toEqual(stored.map((a) => [a.id, a.kind]));
    expect(await events.probeResults()).toEqual([true, true]);
  });

  it("validates input with plain messages", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);

    const noTitle = await owner.request("/api/tickets", {
      method: "POST",
      body: JSON.stringify({ projectKey: "CB", title: " ", type: "task" }),
    });
    const badType = await owner.request("/api/tickets", {
      method: "POST",
      body: JSON.stringify({ projectKey: "CB", title: "X", type: "chore" }),
    });

    expect(await noTitle.json()).toEqual({ error: "Enter a title." });
    expect(await badType.json()).toEqual({ error: "Pick epic, story, task, or bug." });
  });

  it("returns not-found for another Company's Ticket Key", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await createTicket(owner.request, { projectKey: "CB", title: "Ours" });
    const globex = await createCompany(t, { name: "Globex" });

    const read = await globex.owner.request("/api/tickets/CB-1");
    const edit = await globex.owner.request("/api/tickets/CB-1", {
      method: "PATCH",
      body: JSON.stringify({ title: "Theirs" }),
    });
    const create = await globex.owner.request("/api/tickets", {
      method: "POST",
      body: JSON.stringify({ projectKey: "CB", title: "X", type: "task" }),
    });

    expect([read.status, edit.status, create.status]).toEqual([404, 404, 404]);
  });
});
