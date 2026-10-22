import { describe, expect, it } from "vitest";
import {
  activityOf,
  buildTestApp,
  createAgent,
  createApiKey,
  createCompany,
  createProject,
  createTicket,
  type Fetch,
  openStream,
  type TestApp,
} from "./harness";

async function setup(t: TestApp) {
  const { owner } = await createCompany(t, { name: "Acme" });
  const agent = await createAgent(owner, "Claude-1");
  const { bearer } = await createApiKey(t, owner, agent.id);
  await createProject(owner.request, { name: "Board", key: "CB" });
  return { owner, agent, bearer };
}

/** Creates `count` tasks in CB, numbered from CB-1. */
async function tasks(as: Fetch, count: number) {
  for (let i = 1; i <= count; i++) {
    await createTicket(as, { projectKey: "CB", title: `Task ${i}` });
  }
}

async function call(as: Fetch, path: string, body?: object, method = "POST") {
  const res = await as(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status >= 400) throw new Error(`${method} ${path} failed: ${await res.text()}`);
  return res;
}

const blocks = (as: Fetch, blocker: string, blocked: string) =>
  call(as, `/api/tickets/${blocker}/links`, { kind: "blocks", target: blocked });
const move = (as: Fetch, key: string, status: string) =>
  call(as, `/api/tickets/${key}/move`, { status });

/** A Ticket's Blocked state as `[blocked, blockedByCount]`. */
async function blockedOf(as: Fetch, key: string) {
  const res = await as(`/api/tickets/${key}`);
  if (res.status !== 200) throw new Error(`get failed: ${await res.text()}`);
  const { ticket } = (await res.json()) as { ticket: { blocked: boolean; blockedByCount: number } };
  return [ticket.blocked, ticket.blockedByCount];
}

describe("Blocked", () => {
  it("is Blocked while a blocker is open, and not once it is Done, until it leaves Done", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await tasks(owner.request, 3);
    expect(await blockedOf(owner.request, "CB-3")).toEqual([false, 0]);

    await blocks(owner.request, "CB-1", "CB-3");
    await blocks(owner.request, "CB-2", "CB-3");
    expect(await blockedOf(owner.request, "CB-3")).toEqual([true, 2]);

    await move(owner.request, "CB-1", "done");
    expect(await blockedOf(owner.request, "CB-3")).toEqual([true, 1]);
    await move(owner.request, "CB-2", "review");
    expect(await blockedOf(owner.request, "CB-3")).toEqual([true, 1]);
    await move(owner.request, "CB-2", "done");
    expect(await blockedOf(owner.request, "CB-3")).toEqual([false, 0]);

    await move(owner.request, "CB-1", "todo");
    expect(await blockedOf(owner.request, "CB-3")).toEqual([true, 1]);
  });

  it("is not Blocked by an archived blocker until it is restored, nor by a hard-deleted one", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await tasks(owner.request, 3);
    await blocks(owner.request, "CB-1", "CB-3");
    await blocks(owner.request, "CB-2", "CB-3");

    await call(owner.request, "/api/tickets/CB-1/archive");
    expect(await blockedOf(owner.request, "CB-3")).toEqual([true, 1]);
    await call(owner.request, "/api/tickets/CB-2/archive");
    expect(await blockedOf(owner.request, "CB-3")).toEqual([false, 0]);
    await call(owner.request, "/api/tickets/CB-1/restore");
    expect(await blockedOf(owner.request, "CB-3")).toEqual([true, 1]);

    await call(owner.request, "/api/tickets/CB-1", undefined, "DELETE");
    expect(await blockedOf(owner.request, "CB-3")).toEqual([false, 0]);
  });
});

describe("The blocked filter", () => {
  /** Keys listed for a query string. */
  async function listed(as: Fetch, query: string) {
    const res = await as(`/api/tickets?${query}`);
    if (res.status !== 200) throw new Error(`list failed: ${await res.text()}`);
    const { tickets } = (await res.json()) as { tickets: { key: string }[] };
    return tickets.map((ticket) => ticket.key).sort();
  }

  async function board(t: TestApp) {
    const { owner, bearer } = await setup(t);
    for (const title of ["Login page", "Login API", "Signup page", "Blocker"]) {
      await createTicket(owner.request, { projectKey: "CB", title });
    }
    await blocks(owner.request, "CB-4", "CB-1");
    await blocks(owner.request, "CB-4", "CB-3");
    await move(owner.request, "CB-3", "todo");
    return { owner, bearer };
  }

  it.each([
    ["blocked=true", ["CB-1", "CB-3"]],
    ["blocked=false", ["CB-2", "CB-4"]],
    ["", ["CB-1", "CB-2", "CB-3", "CB-4"]],
    ["blocked=true&status=backlog", ["CB-1"]],
    ["blocked=false&q=login", ["CB-2"]],
    ["blocked=true&q=login", ["CB-1"]],
  ])("lists %s as %j", async (query, keys) => {
    const t = buildTestApp();
    const { owner, bearer } = await board(t);

    expect(await listed(owner.request, query)).toEqual(keys);
    expect(await listed(bearer, query)).toEqual(keys);
  });

  it("follows a blocker into Done", async () => {
    const t = buildTestApp();
    const { owner } = await board(t);

    await move(owner.request, "CB-4", "done");

    expect(await listed(owner.request, "blocked=true")).toEqual([]);
  });

  it("refuses any value but true or false", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);

    const res = await owner.request("/api/tickets?blocked=yes");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Use blocked=true or blocked=false." });
  });
});

describe("Claim on a Blocked Ticket", () => {
  const claim = (as: Fetch, key: string) => as(`/api/tickets/${key}/claim`, { method: "POST" });

  it("is refused, naming the open blockers, until the last one is Done", async () => {
    const t = buildTestApp();
    const { owner, agent, bearer } = await setup(t);
    await tasks(owner.request, 7);
    await move(owner.request, "CB-7", "todo");
    await blocks(owner.request, "CB-5", "CB-7");
    await blocks(owner.request, "CB-3", "CB-7");
    await blocks(owner.request, "CB-1", "CB-7");
    await move(owner.request, "CB-1", "done");

    const refused = await claim(bearer, "CB-7");

    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: "CB-7 is blocked by CB-3 and CB-5.",
      blockers: ["CB-3", "CB-5"],
    });
    expect(await (await owner.request("/api/tickets/CB-7")).json()).toMatchObject({
      ticket: { status: "todo", assignee: null },
    });

    await move(owner.request, "CB-3", "done");
    const stillRefused = await claim(bearer, "CB-7");
    expect(await stillRefused.json()).toMatchObject({ error: "CB-7 is blocked by CB-5." });

    await move(owner.request, "CB-5", "done");
    const claimed = await claim(bearer, "CB-7");

    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toMatchObject({
      ticket: { status: "in_progress", assignee: { type: "agent", id: agent.id }, blocked: false },
    });
  });

  it("names three or more blockers as a list", async () => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t);
    await tasks(owner.request, 4);
    for (const blocker of ["CB-1", "CB-2", "CB-3"]) await blocks(owner.request, blocker, "CB-4");

    const refused = await claim(bearer, "CB-4");

    expect(await refused.json()).toMatchObject({
      error: "CB-4 is blocked by CB-1, CB-2, and CB-3.",
    });
  });

  it("still lets an Actor assign and move a Blocked Ticket", async () => {
    const t = buildTestApp();
    const { owner, agent, bearer } = await setup(t);
    await tasks(owner.request, 2);
    await blocks(owner.request, "CB-1", "CB-2");

    const assigned = await owner.request("/api/tickets/CB-2/assign", {
      method: "POST",
      body: JSON.stringify({ assignee: { type: "agent", id: agent.id } }),
    });
    const moved = await bearer("/api/tickets/CB-2/move", {
      method: "POST",
      body: JSON.stringify({ status: "done" }),
    });

    expect(assigned.status).toBe(200);
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({
      ticket: { status: "done", assignee: { id: agent.id }, blocked: true, blockedByCount: 1 },
    });
  });
});

describe("Blocked transitions", () => {
  const link = (as: Fetch, key: string, kind: string, target: string) =>
    call(as, `/api/tickets/${key}/links`, { kind, target });
  const unlink = (as: Fetch, key: string, target: string) =>
    call(as, `/api/tickets/${key}/links/${target}`, undefined, "DELETE");
  const archive = (as: Fetch, key: string) => call(as, `/api/tickets/${key}/archive`);
  const restore = (as: Fetch, key: string) => call(as, `/api/tickets/${key}/restore`);

  /** A dependent's ticket.blocked and ticket.unblocked Activity, as [kind, cause, reason, Actor id]. */
  async function transitionsOf(as: Fetch, key: string) {
    return (await activityOf(as, key))
      .filter((a) => a.kind === "ticket.blocked" || a.kind === "ticket.unblocked")
      .map((a) => [a.kind, a.payload.ticket, a.payload.reason, a.actor.id]);
  }

  type Case = {
    change: string;
    /** Archiving, restoring, and deleting are for Users only. */
    by: "user" | "agent";
    prepare: (as: Fetch) => Promise<unknown>;
    act: (as: Fetch) => Promise<unknown>;
    /** What `act` records on CB-2 as [kind, cause, reason]. CB-3 stays Blocked by CB-4 throughout. */
    recorded: [string, string, string][];
  };
  const blockBoth = async (as: Fetch) => {
    await blocks(as, "CB-1", "CB-2");
    await blocks(as, "CB-1", "CB-3");
  };
  const cases: Case[] = [
    {
      change: "a blocker moving to Done",
      by: "agent",
      prepare: blockBoth,
      act: (as) => move(as, "CB-1", "done"),
      recorded: [["ticket.unblocked", "CB-1", "done"]],
    },
    {
      change: "a blocker moving out of Done",
      by: "agent",
      prepare: async (as) => {
        await blockBoth(as);
        await move(as, "CB-1", "done");
      },
      act: (as) => move(as, "CB-1", "todo"),
      recorded: [["ticket.blocked", "CB-1", "reopened"]],
    },
    {
      change: "a blocker moving between open Statuses",
      by: "agent",
      prepare: blockBoth,
      act: (as) => move(as, "CB-1", "review"),
      recorded: [],
    },
    {
      change: "a blocker being archived",
      by: "user",
      prepare: blockBoth,
      act: (as) => archive(as, "CB-1"),
      recorded: [["ticket.unblocked", "CB-1", "archived"]],
    },
    {
      change: "a blocker being restored",
      by: "user",
      prepare: async (as) => {
        await blockBoth(as);
        await archive(as, "CB-1");
      },
      act: (as) => restore(as, "CB-1"),
      recorded: [["ticket.blocked", "CB-1", "restored"]],
    },
    {
      change: "a Done blocker being archived",
      by: "user",
      prepare: async (as) => {
        await blockBoth(as);
        await move(as, "CB-1", "done");
      },
      act: (as) => archive(as, "CB-1"),
      recorded: [],
    },
    {
      change: "a blocker being hard-deleted",
      by: "user",
      prepare: blockBoth,
      act: (as) => call(as, "/api/tickets/CB-1", undefined, "DELETE"),
      recorded: [["ticket.unblocked", "CB-1", "deleted"]],
    },
    {
      change: "a Blocks Link being added",
      by: "agent",
      prepare: async () => {},
      act: blockBoth,
      recorded: [["ticket.blocked", "CB-1", "linked"]],
    },
    {
      change: "a Blocks Link being added from the blocked side",
      by: "agent",
      prepare: async () => {},
      act: async (as) => {
        await link(as, "CB-2", "blocked_by", "CB-1");
        await link(as, "CB-3", "blocked_by", "CB-1");
      },
      recorded: [["ticket.blocked", "CB-1", "linked"]],
    },
    {
      change: "a Done blocker being linked",
      by: "agent",
      prepare: (as) => move(as, "CB-1", "done"),
      act: blockBoth,
      recorded: [],
    },
    {
      change: "a Blocks Link being removed",
      by: "agent",
      prepare: blockBoth,
      act: async (as) => {
        await unlink(as, "CB-2", "CB-1");
        await unlink(as, "CB-1", "CB-3");
      },
      recorded: [["ticket.unblocked", "CB-1", "unlinked"]],
    },
    {
      change: "a Relates to Link being added",
      by: "agent",
      prepare: async () => {},
      act: async (as) => {
        await link(as, "CB-1", "relates_to", "CB-2");
        await link(as, "CB-1", "relates_to", "CB-3");
      },
      recorded: [],
    },
  ];

  it.each(cases)(
    "records only flips on dependents, by the Actor, on $change",
    async ({ by, prepare, act, recorded }) => {
      const t = buildTestApp();
      const { owner, agent, bearer } = await setup(t);
      await tasks(owner.request, 4);
      await blocks(owner.request, "CB-4", "CB-3");
      const as = by === "user" ? owner.request : bearer;
      const actorId = by === "user" ? owner.user.id : agent.id;
      await prepare(owner.request);
      const before = {
        "CB-2": await transitionsOf(owner.request, "CB-2"),
        "CB-3": await transitionsOf(owner.request, "CB-3"),
      };

      await act(as);

      expect((await transitionsOf(owner.request, "CB-2")).slice(before["CB-2"].length)).toEqual(
        recorded.map((entry) => [...entry, actorId]),
      );
      expect(await transitionsOf(owner.request, "CB-3")).toEqual(before["CB-3"]);
    },
  );

  it("streams ticket.unblocked with the dependent's snapshot when its blocker moves to Done", async () => {
    const t = buildTestApp();
    const { owner, agent, bearer } = await setup(t);
    await tasks(owner.request, 2);
    await blocks(owner.request, "CB-1", "CB-2");
    const stream = await openStream(owner.request);

    await move(bearer, "CB-1", "done");
    const moved = await stream.nextEvent();
    const unblocked = await stream.nextEvent();
    await stream.close();

    expect(moved.event).toBe("ticket.moved");
    expect(unblocked.event).toBe("ticket.unblocked");
    expect(JSON.parse(unblocked.data)).toMatchObject({
      activity: {
        kind: "ticket.unblocked",
        ticketKey: "CB-2",
        actor: { type: "agent", id: agent.id },
        payload: { ticket: "CB-1", reason: "done" },
      },
      ticket: { key: "CB-2", blocked: false, blockedByCount: 0 },
    });
  });
});
