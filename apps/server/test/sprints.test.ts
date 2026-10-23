import type { CompanyRole } from "@agentkanban/shared";
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

/** Acme with Projects CB and WEB, as its owner, an admin, a member, and Agent Claude-1. */
async function setup(t: TestApp) {
  const { owner, members } = await createCompany(t, {
    name: "Acme",
    members: [
      { email: "admin@example.com", role: "admin" },
      { email: "member@example.com", role: "member" },
    ],
  });
  const agent = await createAgent(owner, "Claude-1");
  const { bearer } = await createApiKey(t, owner, agent.id);
  await createProject(owner.request, { name: "Board", key: "CB" });
  await createProject(owner.request, { name: "Web", key: "WEB" });
  const [admin, member] = members;
  if (!admin || !member) throw new Error("members missing");
  return { owner, admin, member, agent, bearer };
}
type Setup = Awaited<ReturnType<typeof setup>>;

type SprintJson = {
  id: string;
  number: number;
  goal: string;
  state: string;
  startedAt: string | null;
  endsOn: string | null;
  finishedAt: string | null;
  ticketCount: number;
  doneCount: number;
  points: number;
};

type TicketJson = {
  key: string;
  status: string;
  rank: string;
  archivedAt: string | null;
  parent: { key: string } | null;
  sprint: { number: number; state: string } | null;
};

const send = (as: Fetch, path: string, method: string, body?: object) =>
  as(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

async function ok<T>(res: Response, status = 200): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

async function newSprint(as: Fetch, projectKey = "CB", goal?: string) {
  const res = await send(as, `/api/projects/${projectKey}/sprints`, "POST", goal ? { goal } : {});
  return (await ok<{ sprint: SprintJson }>(res, 201)).sprint;
}

async function start(as: Fetch, number: number, body: object = {}, projectKey = "CB") {
  const res = await send(as, `/api/projects/${projectKey}/sprints/${number}/start`, "POST", body);
  return (await ok<{ sprint: SprintJson }>(res)).sprint;
}

async function finish(as: Fetch, number: number, projectKey = "CB") {
  const res = await send(as, `/api/projects/${projectKey}/sprints/${number}/finish`, "POST");
  return ok<{ sprint: SprintJson; next: SprintJson }>(res);
}

async function sprintsOf(as: Fetch, projectKey = "CB") {
  return (await ok<{ sprints: SprintJson[] }>(await as(`/api/projects/${projectKey}/sprints`)))
    .sprints;
}

async function ticket(as: Fetch, key: string) {
  return (await ok<{ ticket: TicketJson }>(await as(`/api/tickets/${key}`))).ticket;
}

const patch = (as: Fetch, key: string, body: object) =>
  send(as, `/api/tickets/${key}`, "PATCH", body);

const move = (as: Fetch, key: string, status: string) =>
  send(as, `/api/tickets/${key}/move`, "POST", { status });

async function refusal(res: Response, status: number, error: string) {
  expect(res.status, error).toBe(status);
  expect(await res.json()).toEqual({ error });
}

/** The listed Ticket Keys, sorted. */
async function keysWith(as: Fetch, query: string) {
  const res = await as(`/api/tickets?${query}`);
  return (await ok<{ tickets: { key: string }[] }>(res)).tickets.map((t) => t.key).sort();
}

const day = 24 * 60 * 60 * 1000;

describe("Sprint lifecycle", () => {
  it("numbers Sprints per Project from 1, lists them by number, and never reuses a deleted number", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);

    expect(await newSprint(owner.request, "CB", "  Ship login  ")).toMatchObject({
      number: 1,
      goal: "Ship login",
      state: "planned",
      startedAt: null,
      endsOn: null,
      finishedAt: null,
    });
    await newSprint(owner.request);
    expect((await newSprint(owner.request, "WEB")).number).toBe(1);
    expect((await send(owner.request, "/api/projects/CB/sprints/2", "DELETE")).status).toBe(204);
    expect((await newSprint(owner.request)).number).toBe(3);

    expect((await sprintsOf(owner.request)).map((s) => s.number)).toEqual([1, 3]);
  });

  it("starts a Sprint for two weeks by default, then as long as the last finished one ran", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await newSprint(owner.request);

    const first = await start(owner.request, 1, { goal: "First" });
    expect(first).toMatchObject({
      state: "active",
      goal: "First",
      startedAt: "2026-01-01T00:00:00.000Z",
      endsOn: "2026-01-15",
    });
    await send(owner.request, "/api/projects/CB/sprints/1", "PATCH", { endsOn: "2026-01-06" });
    t.clock.advance(5 * day);
    await finish(owner.request, 1);

    t.clock.advance(day);
    expect(await start(owner.request, 2)).toMatchObject({
      state: "active",
      startedAt: "2026-01-07T00:00:00.000Z",
      endsOn: "2026-01-12",
    });
  });

  it("refuses a second active Sprint, starting a Sprint that isn't planned, and an end before the start", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await newSprint(owner.request);
    await newSprint(owner.request);
    await start(owner.request, 1);
    const path = "/api/projects/CB/sprints";

    await refusal(
      await send(owner.request, `${path}/2/start`, "POST", {}),
      409,
      "Finish Sprint 1 before starting another.",
    );
    await refusal(
      await send(owner.request, `${path}/1/start`, "POST", {}),
      409,
      "Sprint 1 isn't planned.",
    );
    await finish(owner.request, 1);
    await refusal(
      await send(owner.request, `${path}/2/start`, "POST", { endsOn: "2025-12-31" }),
      400,
      "The end date can't be before the start date.",
    );
    await refusal(
      await send(owner.request, `${path}/2/start`, "POST", { endsOn: "next friday" }),
      400,
      "Give the end date as YYYY-MM-DD.",
    );
    // A Sprint ending the day it starts is allowed.
    expect((await start(owner.request, 2, { endsOn: "2026-01-01" })).endsOn).toBe("2026-01-01");
    // Starting in another Project is unaffected.
    await newSprint(owner.request, "WEB");
    expect((await start(owner.request, 1, {}, "WEB")).state).toBe("active");
  });

  it("edits any open Sprint's goal and only the active Sprint's end date, and nothing once finished", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await newSprint(owner.request);
    await newSprint(owner.request);
    const edit = (number: number, body: object) =>
      send(owner.request, `/api/projects/CB/sprints/${number}`, "PATCH", body);

    expect((await ok<{ sprint: SprintJson }>(await edit(2, { goal: "Later" }))).sprint.goal).toBe(
      "Later",
    );
    await refusal(
      await edit(2, { endsOn: "2026-02-01" }),
      400,
      "Set the end date when you start the sprint.",
    );
    await refusal(
      await edit(2, { goal: "x".repeat(501) }),
      400,
      "Sprint goals can be up to 500 characters.",
    );
    await start(owner.request, 1);
    expect(
      (await ok<{ sprint: SprintJson }>(await edit(1, { endsOn: "2026-01-20" }))).sprint.endsOn,
    ).toBe("2026-01-20");
    await refusal(
      await edit(1, { endsOn: "2025-12-01" }),
      400,
      "The end date can't be before the start date.",
    );
    await finish(owner.request, 1);
    await refusal(await edit(1, { goal: "Too late" }), 409, "Sprint 1 is finished.");
  });

  it("deletes only a Planned Sprint, taking its Tickets out of it, archived ones too", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await newSprint(owner.request);
    await newSprint(owner.request);
    await createTicket(owner.request, { projectKey: "CB", title: "Live", sprint: 2 });
    await createTicket(owner.request, { projectKey: "CB", title: "Archived", sprint: 2 });
    await send(owner.request, "/api/tickets/CB-2/archive", "POST");
    const remove = (number: number | string) =>
      send(owner.request, `/api/projects/CB/sprints/${number}`, "DELETE");

    expect((await remove(2)).status).toBe(204);
    for (const key of ["CB-1", "CB-2"]) {
      expect((await ticket(owner.request, key)).sprint).toBeNull();
      expect((await activityOf(owner.request, key)).at(-1)).toMatchObject({
        kind: "ticket.updated",
        payload: { changes: { sprint: { from: 2, to: null } } },
      });
    }

    await start(owner.request, 1);
    await refusal(await remove(1), 409, "You can delete only a planned sprint.");
    await finish(owner.request, 1);
    await refusal(await remove(1), 409, "You can delete only a planned sprint.");
    for (const number of [9, "x", 0]) {
      expect((await remove(number)).status).toBe(404);
    }
  });

  it("counts each Sprint's live Tickets, its Done ones, and their points", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await newSprint(owner.request);
    await createTicket(owner.request, { projectKey: "CB", title: "A", sprint: 1, estimate: 3 });
    await createTicket(owner.request, { projectKey: "CB", title: "B", sprint: 1, estimate: 5 });
    await createTicket(owner.request, { projectKey: "CB", title: "C", sprint: 1 });
    await createTicket(owner.request, { projectKey: "CB", title: "Gone", sprint: 1, estimate: 8 });
    await move(owner.request, "CB-2", "done");
    await send(owner.request, "/api/tickets/CB-4/archive", "POST");

    expect((await sprintsOf(owner.request))[0]).toMatchObject({
      ticketCount: 3,
      doneCount: 1,
      points: 8,
    });
  });
});

describe("Who manages Sprints", () => {
  const roles: CompanyRole[] = ["owner", "admin", "member"];
  const as = (s: Setup, role: CompanyRole) =>
    role === "owner" ? s.owner.request : role === "admin" ? s.admin.request : s.member.request;

  for (const role of roles) {
    it(`lets a User with the ${role} Role create, edit, start, finish, and delete Sprints`, async () => {
      const t = buildTestApp();
      const user = as(await setup(t), role);

      await newSprint(user);
      await newSprint(user);
      const edited = await send(user, "/api/projects/CB/sprints/1", "PATCH", { goal: "Go" });
      expect(edited.status).toBe(200);
      await start(user, 1);
      await finish(user, 1);
      expect((await send(user, "/api/projects/CB/sprints/2", "DELETE")).status).toBe(204);
    });
  }

  it("lets an Agent read Sprints but change none of them", async () => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t);
    await newSprint(owner.request);
    await newSprint(owner.request);
    await start(owner.request, 1);
    const path = "/api/projects/CB/sprints";

    expect((await sprintsOf(bearer)).map((s) => s.number)).toEqual([1, 2]);
    for (const [method, url, body] of [
      ["POST", path, {}],
      ["PATCH", `${path}/2`, { goal: "Mine" }],
      ["POST", `${path}/2/start`, {}],
      ["POST", `${path}/1/finish`, undefined],
      ["DELETE", `${path}/2`, undefined],
    ] as const) {
      await refusal(await send(bearer, url, method, body), 403, "Agents can't change sprints.");
    }
    expect((await sprintsOf(owner.request)).map((s) => s.state)).toEqual(["active", "planned"]);
  });

  it("finds no Sprints in another Company's Project", async () => {
    const t = buildTestApp();
    await setup(t);
    const other = await createCompany(t, { name: "Other" });
    await createProject(other.owner.request, { name: "Theirs", key: "TH" });
    await newSprint(other.owner.request, "TH");
    const { owner } = await createCompany(t, { name: "Mine" });

    expect((await owner.request("/api/projects/TH/sprints")).status).toBe(404);
    expect((await send(owner.request, "/api/projects/TH/sprints/1/start", "POST", {})).status).toBe(
      404,
    );
  });
});

describe("Finishing a Sprint", () => {
  it("archives its Done Tickets and moves the rest to the lowest Planned Sprint, keeping Status and rank", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    for (let i = 0; i < 3; i++) await newSprint(owner.request);
    await start(owner.request, 1);
    for (const title of ["Done", "To do", "Doing", "Later", "Shelved"]) {
      await createTicket(owner.request, { projectKey: "CB", title, sprint: 1 });
    }
    await move(owner.request, "CB-1", "done");
    await move(owner.request, "CB-2", "todo");
    await move(owner.request, "CB-3", "in_progress");
    await send(owner.request, "/api/tickets/CB-5/archive", "POST");
    const before = await Promise.all(["CB-2", "CB-3", "CB-4"].map((k) => ticket(owner.request, k)));

    const { sprint, next } = await finish(owner.request, 1);

    expect(sprint).toMatchObject({ number: 1, state: "finished", ticketCount: 0 });
    expect(sprint.finishedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(next).toMatchObject({ number: 2, state: "planned", ticketCount: 3 });
    expect(await ticket(owner.request, "CB-1")).toMatchObject({
      archivedAt: expect.any(String),
      sprint: { number: 1, state: "finished" },
    });
    for (const held of before) {
      expect(await ticket(owner.request, held.key)).toMatchObject({
        status: held.status,
        rank: held.rank,
        archivedAt: null,
        sprint: { number: 2, state: "planned" },
      });
    }
    // Already archived, so it stays with the Sprint it was in.
    expect((await ticket(owner.request, "CB-5")).sprint).toEqual({ number: 1, state: "finished" });

    expect((await activityOf(owner.request, "CB-1")).at(-1)).toMatchObject({
      kind: "ticket.archived",
      payload: { detached: [], sprint: 1 },
    });
    expect((await activityOf(owner.request, "CB-2")).at(-1)).toMatchObject({
      kind: "ticket.updated",
      payload: { changes: { sprint: { from: 1, to: 2 } } },
    });
    expect((await sprintsOf(owner.request)).map((s) => [s.number, s.state])).toEqual([
      [1, "finished"],
      [2, "planned"],
      [3, "planned"],
    ]);
  });

  it("makes a new Planned Sprint for the rest when there is none", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await newSprint(owner.request);
    await start(owner.request, 1);
    await createTicket(owner.request, { projectKey: "CB", title: "Carry", sprint: 1 });

    const { next } = await finish(owner.request, 1);

    expect(next).toMatchObject({ number: 2, state: "planned", goal: "", ticketCount: 1 });
    expect((await ticket(owner.request, "CB-1")).sprint).toEqual({ number: 2, state: "planned" });
  });

  it("finishes an empty Sprint", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await newSprint(owner.request);
    await start(owner.request, 1);

    expect((await finish(owner.request, 1)).sprint.state).toBe("finished");
  });

  it("detaches the children of a Done Ticket it archives, as archiving does", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await newSprint(owner.request);
    await start(owner.request, 1);
    await createTicket(owner.request, { projectKey: "CB", title: "S", type: "story", sprint: 1 });
    await createTicket(owner.request, {
      projectKey: "CB",
      title: "T",
      parentKey: "CB-1",
      sprint: 1,
    });
    await move(owner.request, "CB-1", "done");

    await finish(owner.request, 1);

    expect(await ticket(owner.request, "CB-2")).toMatchObject({
      parent: null,
      sprint: { number: 2, state: "planned" },
    });
    expect((await activityOf(owner.request, "CB-1")).at(-1)).toMatchObject({
      kind: "ticket.archived",
      payload: { detached: ["CB-2"], sprint: 1 },
    });
  });

  it("refuses a Sprint that isn't active", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await newSprint(owner.request);

    await refusal(
      await send(owner.request, "/api/projects/CB/sprints/1/finish", "POST"),
      409,
      "Only the active sprint can be finished.",
    );
  });
});

describe("Tickets in Sprints", () => {
  const actors = [
    { name: "a User", as: (s: Setup): Fetch => s.owner.request },
    { name: "an Agent", as: (s: Setup): Fetch => s.bearer },
  ];

  for (const actor of actors) {
    describe(`as ${actor.name}`, () => {
      it("puts a Ticket in a Sprint, moves it, and takes it out, recording each change once", async () => {
        const t = buildTestApp();
        const s = await setup(t);
        const as = actor.as(s);
        await newSprint(s.owner.request);
        await newSprint(s.owner.request);
        await start(s.owner.request, 1);

        const created = await createTicket(as, { projectKey: "CB", title: "A", sprint: 1 });
        expect(created.sprint).toEqual({ number: 1, state: "active" });
        expect((await createTicket(as, { projectKey: "CB", title: "B" })).sprint).toBeNull();

        await ok(await patch(as, "CB-1", { sprint: 2 }));
        await ok(await patch(as, "CB-1", { sprint: 2 }));
        await ok(await patch(as, "CB-1", { sprint: null }));

        const changes = (await activityOf(as, "CB-1"))
          .filter((a) => a.kind === "ticket.updated")
          .map((a) => a.payload.changes);
        expect(changes).toEqual([
          { sprint: { from: 1, to: 2 } },
          { sprint: { from: 2, to: null } },
        ]);
        expect((await ticket(as, "CB-1")).sprint).toBeNull();
      });

      it("refuses Epics, Sprints the Project doesn't have, and Finished Sprints", async () => {
        const t = buildTestApp();
        const s = await setup(t);
        const as = actor.as(s);
        await newSprint(s.owner.request);
        for (let i = 0; i < 3; i++) await newSprint(s.owner.request, "WEB");
        await start(s.owner.request, 1);
        await finish(s.owner.request, 1);
        await createTicket(as, { projectKey: "CB", title: "A" });

        for (const [body, status, error] of [
          [{ type: "epic", sprint: 2 }, 400, "Epics can't be in a sprint."],
          [{ sprint: 3 }, 400, "CB has no Sprint 3."],
          [{ sprint: 1 }, 400, "Sprint 1 is finished."],
          [{ sprint: 0 }, 400, "Sprints are numbered from 1."],
          [{ sprint: "2" }, 400, "Sprints are numbered from 1."],
        ] as const) {
          const created = await send(as, "/api/tickets", "POST", {
            projectKey: "CB",
            title: "X",
            type: "task",
            ...body,
          });
          await refusal(created, status, error);
          await refusal(await patch(as, "CB-1", body), status, error);
        }
      });

      it("refuses making a Ticket in a Sprint an Epic", async () => {
        const t = buildTestApp();
        const s = await setup(t);
        const as = actor.as(s);
        await newSprint(s.owner.request);
        await createTicket(as, { projectKey: "CB", title: "A", sprint: 1 });

        await refusal(
          await patch(as, "CB-1", { type: "epic" }),
          400,
          "Remove CB-1 from Sprint 1 before making it an epic.",
        );
        if (actor.name === "a User") {
          const both = await ok<{ ticket: TicketJson }>(
            await patch(as, "CB-1", { type: "epic", sprint: null }),
          );
          expect(both.ticket.sprint).toBeNull();
        }
      });
    });
  }

  it("refuses changing an archived Ticket's Sprint, and leaves it there through restore while the Sprint is open", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await newSprint(owner.request);
    await newSprint(owner.request);
    await createTicket(owner.request, { projectKey: "CB", title: "A", sprint: 1 });
    await send(owner.request, "/api/tickets/CB-1/archive", "POST");

    await refusal(
      await patch(owner.request, "CB-1", { sprint: 2 }),
      409,
      "Restore CB-1 before changing its sprint.",
    );
    // Other fields still change, as before.
    expect((await patch(owner.request, "CB-1", { estimate: 3 })).status).toBe(200);
    await send(owner.request, "/api/tickets/CB-1/restore", "POST");
    expect((await ticket(owner.request, "CB-1")).sprint).toEqual({ number: 1, state: "planned" });
  });

  it("restores a Ticket whose Sprint finished in no Sprint, and says which Sprint it left", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await newSprint(owner.request);
    await start(owner.request, 1);
    await createTicket(owner.request, { projectKey: "CB", title: "A", sprint: 1 });
    await move(owner.request, "CB-1", "done");
    await finish(owner.request, 1);

    const res = await send(owner.request, "/api/tickets/CB-1/restore", "POST");

    expect((await ok<{ ticket: TicketJson }>(res)).ticket.sprint).toBeNull();
    expect((await activityOf(owner.request, "CB-1")).at(-1)).toMatchObject({
      kind: "ticket.restored",
      payload: { sprint: 1 },
    });
  });
});

describe("The sprint filter", () => {
  it("lists the active Sprint's Tickets, Tickets in no Sprint, or a Sprint by number, with other filters", async () => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t);
    await newSprint(owner.request);
    await newSprint(owner.request);
    await newSprint(owner.request, "WEB");
    await start(owner.request, 1);
    await createTicket(owner.request, { projectKey: "CB", title: "Active", sprint: 1 });
    await createTicket(owner.request, {
      projectKey: "CB",
      title: "Active bug",
      sprint: 1,
      type: "bug",
    });
    await createTicket(owner.request, { projectKey: "CB", title: "Planned", sprint: 2 });
    await createTicket(owner.request, { projectKey: "CB", title: "Unplanned" });
    await createTicket(owner.request, { projectKey: "WEB", title: "Web one", sprint: 1 });

    for (const as of [owner.request, bearer]) {
      expect(await keysWith(as, "projectKey=CB&sprint=active")).toEqual(["CB-1", "CB-2"]);
      expect(await keysWith(as, "sprint=active&type=bug")).toEqual(["CB-2"]);
      expect(await keysWith(as, "projectKey=CB&sprint=none")).toEqual(["CB-4"]);
      expect(await keysWith(as, "projectKey=CB&sprint=2")).toEqual(["CB-3"]);
      // A number is matched in each Ticket's own Project.
      expect(await keysWith(as, "sprint=1")).toEqual(["CB-1", "CB-2", "WEB-1"]);
      expect(await keysWith(as, "sprint=9")).toEqual([]);
    }
    for (const value of ["soon", "0", "-1", ""]) {
      await refusal(
        await owner.request(`/api/tickets?sprint=${value}`),
        400,
        "Filter sprints by active, none, or a sprint number.",
      );
    }
  });
});

describe("Sprints on the live stream", () => {
  it("sends Sprint Activity with the Project Key and number, and Sprint changes in the Ticket snapshot", async () => {
    const t = buildTestApp();
    const { owner, member } = await setup(t);
    await createTicket(owner.request, { projectKey: "CB", title: "A" });
    const stream = await openStream(member.request);

    await newSprint(owner.request, "CB", "Go");
    const created = JSON.parse((await stream.nextEvent()).data);
    await patch(owner.request, "CB-1", { sprint: 1 });
    const moved = JSON.parse((await stream.nextEvent()).data);
    await start(owner.request, 1, { endsOn: "2026-01-10" });
    const started = await stream.nextEvent();
    await finish(owner.request, 1);
    const finishEvents = [
      await stream.nextEvent(),
      await stream.nextEvent(),
      await stream.nextEvent(),
    ];
    await stream.close();

    expect(created).toMatchObject({
      activity: {
        kind: "sprint.created",
        ticketKey: null,
        payload: { projectKey: "CB", number: 1, goal: "Go" },
      },
      ticket: null,
    });
    expect(moved).toMatchObject({
      activity: { kind: "ticket.updated", payload: { changes: { sprint: { from: null, to: 1 } } } },
      ticket: { key: "CB-1", sprint: { number: 1, state: "planned" } },
    });
    expect(started.event).toBe("sprint.started");
    expect(JSON.parse(started.data).activity.payload).toEqual({
      projectKey: "CB",
      number: 1,
      endsOn: "2026-01-10",
    });
    expect(finishEvents.map((e) => e.event)).toEqual([
      "sprint.created",
      "ticket.updated",
      "sprint.finished",
    ]);
    expect(JSON.parse(finishEvents[2]?.data ?? "{}").activity.payload).toEqual({
      projectKey: "CB",
      number: 1,
      next: 2,
      archived: [],
      moved: ["CB-1"],
    });
  });
});
