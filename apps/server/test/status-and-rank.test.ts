import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createAgent,
  createApiKey,
  createCompany,
  createProject,
  createTicket,
  type Fetch,
  type TestApp,
} from "./harness";

type Row = { key: string; status: string; rank: string; updatedAt: string };

async function column(as: Fetch, status: string) {
  const res = await as(`/api/tickets?projectKey=CB&status=${status}`);
  return ((await res.json()) as { tickets: Row[] }).tickets;
}

const keys = (rows: Row[]) => rows.map((r) => r.key);

function move(as: Fetch, key: string, body: object) {
  return as(`/api/tickets/${key}/move`, { method: "POST", body: JSON.stringify(body) });
}

/** CB with Tickets CB-1..CB-n in Backlog, in creation order. */
async function setup(t: TestApp, n = 4) {
  const { owner } = await createCompany(t, { name: "Acme" });
  const agent = await createAgent(owner, "Claude-1");
  const { bearer } = await createApiKey(t, owner, agent.id);
  await createProject(owner.request, { name: "Board", key: "CB" });
  for (let i = 1; i <= n; i++)
    await createTicket(owner.request, { projectKey: "CB", title: `T${i}` });
  return { owner, bearer };
}

describe("Status and rank", () => {
  it("appends new Tickets to the bottom of their column", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t, 3);

    expect(keys(await column(owner.request, "backlog"))).toEqual(["CB-1", "CB-2", "CB-3"]);
  });

  const statuses = ["backlog", "todo", "in_progress", "review", "done"];
  it.each(statuses.flatMap((from) => statuses.filter((to) => to !== from).map((to) => [from, to])))(
    "moves from %s to %s",
    async (from, to) => {
      const t = buildTestApp();
      const { owner, bearer } = await setup(t, 1);
      if (from !== "backlog") await move(owner.request, "CB-1", { status: from });

      const res = await move(bearer, "CB-1", { status: to });

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ticket: { status: to } });
    },
  );

  it("places a Ticket after a neighbour, before a neighbour, or at a position", async () => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t, 4);

    await move(bearer, "CB-4", { after: "CB-1" });
    expect(keys(await column(owner.request, "backlog"))).toEqual(["CB-1", "CB-4", "CB-2", "CB-3"]);

    await move(bearer, "CB-1", { before: "CB-3" });
    expect(keys(await column(owner.request, "backlog"))).toEqual(["CB-4", "CB-2", "CB-1", "CB-3"]);

    await move(owner.request, "CB-3", { position: 0 });
    expect(keys(await column(owner.request, "backlog"))).toEqual(["CB-3", "CB-4", "CB-2", "CB-1"]);

    await move(owner.request, "CB-3", { position: 99 });
    expect(keys(await column(owner.request, "backlog"))).toEqual(["CB-4", "CB-2", "CB-1", "CB-3"]);
  });

  it("places a Ticket at a position in another column", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t, 4);
    await move(owner.request, "CB-1", { status: "todo" });
    await move(owner.request, "CB-2", { status: "todo" });

    await move(owner.request, "CB-3", { status: "todo", position: 1 });

    expect(keys(await column(owner.request, "todo"))).toEqual(["CB-1", "CB-3", "CB-2"]);
    expect(keys(await column(owner.request, "backlog"))).toEqual(["CB-4"]);
  });

  it("moves to the bottom of the target column by default", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t, 3);
    await move(owner.request, "CB-1", { status: "todo" });

    await move(owner.request, "CB-3", { status: "todo" });

    expect(keys(await column(owner.request, "todo"))).toEqual(["CB-1", "CB-3"]);
  });

  it("updates only the moved Ticket", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t, 4);
    const before = await column(owner.request, "backlog");
    t.clock.advance(1000);

    await move(owner.request, "CB-4", { after: "CB-1" });

    const after = await column(owner.request, "backlog");
    const unchanged = (rows: Row[]) =>
      rows.filter((r) => r.key !== "CB-4").map((r) => [r.key, r.rank, r.updatedAt]);
    expect(unchanged(after).sort()).toEqual(unchanged(before).sort());
  });

  it("checks that both neighbours are still next to each other", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t, 4);

    const ok = await move(owner.request, "CB-4", { after: "CB-1", before: "CB-2" });
    const stale = await move(owner.request, "CB-3", { after: "CB-1", before: "CB-2" });

    expect(ok.status).toBe(200);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "The column changed. Refresh and try again." });
  });

  it("rejects a neighbour from another column", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t, 2);

    const res = await move(owner.request, "CB-2", { status: "todo", after: "CB-1" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "CB-1 isn't in the todo column." });
  });

  it("records moves as Activity", async () => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t, 1);

    await move(bearer, "CB-1", { status: "review" });

    const res = await owner.request("/api/tickets/CB-1/activity");
    const { activity } = (await res.json()) as {
      activity: { kind: string; actor: { type: string }; payload: object }[];
    };
    expect(activity.at(-1)).toMatchObject({
      kind: "ticket.moved",
      actor: { type: "agent" },
      payload: { from: { status: "backlog" }, to: { status: "review", rank: expect.any(String) } },
    });
  });
});
