import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createAgent,
  createApiKey,
  createCompany,
  createProject,
  createTicket,
  type Fetch,
  type SignedInUser,
  type TestApp,
} from "./harness";

function assign(as: Fetch, key: string, assignee: object | null) {
  return as(`/api/tickets/${key}/assign`, { method: "POST", body: JSON.stringify({ assignee }) });
}

const claim = (as: Fetch, key: string) => as(`/api/tickets/${key}/claim`, { method: "POST" });

async function setup(t: TestApp) {
  const { owner, members } = await createCompany(t, {
    name: "Acme",
    members: [{ email: "bob@example.com", role: "member" }],
  });
  const bob = members[0] as SignedInUser;
  const first = await createAgent(owner, "Claude-1");
  const second = await createAgent(owner, "Claude-2");
  const one = await createApiKey(t, owner, first.id);
  const two = await createApiKey(t, owner, second.id);
  await createProject(owner.request, { name: "Board", key: "CB" });
  await createTicket(owner.request, { projectKey: "CB", title: "Work" });
  return { owner, bob, first, second, agentOne: one.bearer, agentTwo: two.bearer };
}

describe("Assign", () => {
  it("assigns a User or an Agent, never both, and clears", async () => {
    const t = buildTestApp();
    const { bob, first, agentOne } = await setup(t);

    const toUser = await assign(agentOne, "CB-1", { type: "user", id: bob.user.id });
    expect(await toUser.json()).toMatchObject({
      ticket: { assignee: { type: "user", id: bob.user.id, name: "bob" } },
    });

    const toAgent = await assign(bob.request, "CB-1", { type: "agent", id: first.id });
    expect(await toAgent.json()).toMatchObject({
      ticket: { assignee: { type: "agent", id: first.id, name: "Claude-1", revoked: false } },
    });

    const cleared = await assign(bob.request, "CB-1", null);
    expect(await cleared.json()).toMatchObject({ ticket: { assignee: null } });
  });

  it("refuses a revoked Agent", async () => {
    const t = buildTestApp();
    const { owner, first } = await setup(t);
    await owner.request(`/api/agents/${first.id}/revoke`, { method: "POST" });

    const res = await assign(owner.request, "CB-1", { type: "agent", id: first.id });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That agent was revoked." });
  });

  it("refuses a User or Agent outside the Company", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    const globex = await createCompany(t, { name: "Globex" });
    const theirs = await createAgent(globex.owner, "Theirs");

    const user = await assign(owner.request, "CB-1", { type: "user", id: globex.owner.user.id });
    const agent = await assign(owner.request, "CB-1", { type: "agent", id: theirs.id });

    expect([user.status, agent.status]).toEqual([404, 404]);
  });

  it("records assignment as Activity credited to the acting Actor", async () => {
    const t = buildTestApp();
    const { owner, bob, first, agentOne } = await setup(t);

    await assign(agentOne, "CB-1", { type: "user", id: bob.user.id });

    const res = await owner.request("/api/tickets/CB-1/activity");
    const { activity } = (await res.json()) as { activity: object[] };
    expect(activity.at(-1)).toMatchObject({
      kind: "ticket.assigned",
      actor: { type: "agent", id: first.id },
      payload: { from: null, to: { type: "user", id: bob.user.id } },
    });
  });
});

describe("Claim", () => {
  it("makes the caller the Assignee and moves the Ticket to the bottom of In Progress", async () => {
    const t = buildTestApp();
    const { owner, first, agentOne } = await setup(t);
    await createTicket(owner.request, { projectKey: "CB", title: "Already going" });
    await claim(owner.request, "CB-2");

    const res = await claim(agentOne, "CB-1");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ticket: { status: "in_progress", assignee: { type: "agent", id: first.id } },
    });
    const inProgress = await owner.request("/api/tickets?projectKey=CB&status=in_progress");
    const { tickets } = (await inProgress.json()) as { tickets: { key: string }[] };
    expect(tickets.map((ticket) => ticket.key)).toEqual(["CB-2", "CB-1"]);
  });

  it.each(["backlog", "todo", "review"])("works from %s", async (status) => {
    const t = buildTestApp();
    const { owner, agentOne } = await setup(t);
    await owner.request("/api/tickets/CB-1/move", {
      method: "POST",
      body: JSON.stringify({ status }),
    });

    expect((await claim(agentOne, "CB-1")).status).toBe(200);
  });

  it("works for a human too", async () => {
    const t = buildTestApp();
    const { bob } = await setup(t);

    const res = await claim(bob.request, "CB-1");

    expect(await res.json()).toMatchObject({
      ticket: { assignee: { type: "user", id: bob.user.id } },
    });
  });

  it("fails when someone already holds the Ticket, naming them", async () => {
    const t = buildTestApp();
    const { first, agentOne, agentTwo } = await setup(t);
    await claim(agentOne, "CB-1");

    const res = await claim(agentTwo, "CB-1");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "CB-1 is already held by Claude-1.",
      assignee: { type: "agent", id: first.id, name: "Claude-1", revoked: false },
    });
  });

  it("refuses a Done Ticket", async () => {
    const t = buildTestApp();
    const { owner, agentOne } = await setup(t);
    await owner.request("/api/tickets/CB-1/move", {
      method: "POST",
      body: JSON.stringify({ status: "done" }),
    });

    const res = await claim(agentOne, "CB-1");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Done tickets can't be claimed." });
  });

  it("gives exactly one winner to concurrent Claims", async () => {
    const t = buildTestApp();
    const { owner, agentOne, agentTwo } = await setup(t);

    for (let round = 2; round <= 6; round++) {
      await createTicket(owner.request, { projectKey: "CB", title: `Race ${round}` });
      const results = await Promise.all([
        claim(agentOne, `CB-${round}`),
        claim(agentTwo, `CB-${round}`),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409]);
      const winner = (await results.find((r) => r.status === 200)?.json()) as {
        ticket: { assignee: { name: string } };
      };
      const loser = (await results.find((r) => r.status === 409)?.json()) as {
        assignee: { name: string };
      };
      expect(loser.assignee.name).toBe(winner.ticket.assignee.name);
    }
  });

  it("records the Claim as Activity", async () => {
    const t = buildTestApp();
    const { owner, second, agentTwo } = await setup(t);

    await claim(agentTwo, "CB-1");

    const res = await owner.request("/api/tickets/CB-1/activity");
    const { activity } = (await res.json()) as { activity: object[] };
    expect(activity.at(-1)).toMatchObject({
      kind: "ticket.claimed",
      actor: { type: "agent", id: second.id },
      payload: { from: { status: "backlog" }, to: { status: "in_progress" } },
    });
  });
});
