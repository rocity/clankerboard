import { defaultLabelColor } from "@agentkanban/shared";
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

const actors = [
  { name: "a User", as: (s: Setup): Fetch => s.owner.request },
  { name: "an Agent", as: (s: Setup): Fetch => s.bearer },
];

type LabelJson = { id: string; name: string; color: string; ticketCount: number };

const patch = (as: Fetch, key: string, body: object) =>
  as(`/api/tickets/${key}`, { method: "PATCH", body: JSON.stringify(body) });

async function labelsOn(as: Fetch, key: string) {
  const res = await as(`/api/tickets/${key}`);
  const { ticket } = (await res.json()) as { ticket: { labels: { name: string }[] } };
  return ticket.labels.map((l) => l.name);
}

async function companyLabels(as: Fetch): Promise<LabelJson[]> {
  const res = await as("/api/labels");
  expect(res.status).toBe(200);
  return ((await res.json()) as { labels: LabelJson[] }).labels;
}

/** The listed Ticket Keys, sorted, since ranks interleave across Projects. */
async function keysWith(as: Fetch, query: string) {
  const res = await as(`/api/tickets?${query}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { tickets: { key: string }[] }).tickets.map((t) => t.key).sort();
}

describe("Labels on Tickets", () => {
  for (const actor of actors) {
    describe(`as ${actor.name}`, () => {
      it("creates a Label on first use with its starting color, and reuses it in any case", async () => {
        const t = buildTestApp();
        const as = actor.as(await setup(t));

        const first = await createTicket(as, { projectKey: "CB", title: "A", labels: ["API"] });
        const second = await createTicket(as, {
          projectKey: "WEB",
          title: "B",
          labels: ["  api ", "Web"],
        });

        expect(first.labels).toEqual([
          { id: expect.any(String), name: "API", color: defaultLabelColor("api") },
        ]);
        expect(second.labels.map((l) => l.name)).toEqual(["API", "Web"]);
        expect(second.labels[0]?.id).toBe(first.labels[0]?.id);
        expect((await companyLabels(as)).map((l) => l.name)).toEqual(["API", "Web"]);
      });

      it("counts a name repeated in one change once", async () => {
        const t = buildTestApp();
        const as = actor.as(await setup(t));

        const ticket = await createTicket(as, {
          projectKey: "CB",
          title: "A",
          labels: ["ui", "UI", "Ui "],
        });

        expect(ticket.labels.map((l) => l.name)).toEqual(["ui"]);
      });

      it("refuses more than 10 Labels and names over 30 characters", async () => {
        const t = buildTestApp();
        const as = actor.as(await setup(t));
        await createTicket(as, { projectKey: "CB", title: "A", labels: ["kept"] });
        const eleven = Array.from({ length: 11 }, (_, i) => `l${i}`);

        for (const [labels, error] of [
          [eleven, "A ticket can have up to 10 labels."],
          [["x".repeat(31)], "Label names can be up to 30 characters."],
          [["  "], "Enter a label name."],
          ["api", "Labels are a list of names."],
        ] as const) {
          const created = await as("/api/tickets", {
            method: "POST",
            body: JSON.stringify({ projectKey: "CB", title: "X", type: "task", labels }),
          });
          const updated = await patch(as, "CB-1", { labels });
          for (const res of [created, updated]) {
            expect(res.status, error).toBe(400);
            expect(await res.json()).toEqual({ error });
          }
        }
        expect(await labelsOn(as, "CB-1")).toEqual(["kept"]);
        // Exactly 10 is fine.
        expect((await patch(as, "CB-1", { labels: eleven.slice(1) })).status).toBe(200);
      });

      it("replaces the whole set on update and records the diff only when it changed", async () => {
        const t = buildTestApp();
        const s = await setup(t);
        const as = actor.as(s);
        await createTicket(as, { projectKey: "CB", title: "A", labels: ["web", "api"] });

        expect((await patch(as, "CB-1", { labels: ["API", "Web"] })).status).toBe(200);
        expect((await patch(as, "CB-1", { labels: ["docs", "api"] })).status).toBe(200);
        expect((await patch(as, "CB-1", { labels: [] })).status).toBe(200);
        expect((await patch(as, "CB-1", { title: "Renamed" })).status).toBe(200);

        expect(await labelsOn(as, "CB-1")).toEqual([]);
        const updates = (await activityOf(as, "CB-1")).filter((a) => a.kind === "ticket.updated");
        const credited = as === s.bearer ? { type: "agent", id: s.agent.id } : { type: "user" };
        expect(updates).toMatchObject([
          {
            actor: credited,
            payload: { changes: { labels: { from: ["api", "web"], to: ["api", "docs"] } } },
          },
          { actor: credited, payload: { changes: { labels: { from: ["api", "docs"], to: [] } } } },
          { actor: credited, payload: { changes: { title: { from: "A", to: "Renamed" } } } },
        ]);
        expect(updates[2]?.payload.changes).not.toHaveProperty("labels");
      });

      it("filters by a Label without regard to case, with other filters and search", async () => {
        const t = buildTestApp();
        const as = actor.as(await setup(t));
        await createTicket(as, { projectKey: "CB", title: "Login form", labels: ["api"] });
        await createTicket(as, {
          projectKey: "CB",
          title: "Signup form",
          type: "bug",
          labels: ["API", "web"],
        });
        await createTicket(as, { projectKey: "WEB", title: "Login page", labels: ["api"] });
        await createTicket(as, { projectKey: "CB", title: "Login unlabeled" });

        expect(await keysWith(as, "label=Api")).toEqual(["CB-1", "CB-2", "WEB-1"]);
        expect(await keysWith(as, "label=api&projectKey=CB")).toEqual(["CB-1", "CB-2"]);
        expect(await keysWith(as, "label=api&type=bug")).toEqual(["CB-2"]);
        expect(await keysWith(as, "label=api&q=login")).toEqual(["CB-1", "WEB-1"]);
        expect(await keysWith(as, "label=nothing-has-this")).toEqual([]);
      });
    });
  }

  it("keeps Labels through archive and restore", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    const as = owner.request;
    await createTicket(as, { projectKey: "CB", title: "Shelved", labels: ["api"] });

    expect((await as("/api/tickets/CB-1/archive", { method: "POST" })).status).toBe(200);
    expect(await labelsOn(as, "CB-1")).toEqual(["api"]);
    expect((await as("/api/tickets/CB-1/restore", { method: "POST" })).status).toBe(200);

    expect(await labelsOn(as, "CB-1")).toEqual(["api"]);
  });

  it("keeps each Company's Labels to itself", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    const other = await createCompany(t, { name: "Globex" });
    await createProject(other.owner.request, { name: "Ops", key: "OPS" });
    const ours = await createTicket(owner.request, {
      projectKey: "CB",
      title: "A",
      labels: ["api"],
    });
    const theirs = await createTicket(other.owner.request, {
      projectKey: "OPS",
      title: "B",
      labels: ["API"],
    });

    expect(theirs.labels[0]?.id).not.toBe(ours.labels[0]?.id);
    expect(theirs.labels[0]?.name).toBe("API");
    expect(await keysWith(other.owner.request, "label=api")).toEqual(["OPS-1"]);
    const id = ours.labels[0]?.id;
    const res = await other.owner.request(`/api/labels/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "stolen" }),
    });
    expect(res.status).toBe(404);
  });

  it("settles two concurrent creates of one name on one Label", async () => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t);

    await Promise.all([
      createTicket(owner.request, { projectKey: "CB", title: "A", labels: ["Infra"] }),
      createTicket(bearer, { projectKey: "WEB", title: "B", labels: ["infra"] }),
    ]);

    const labels = await companyLabels(owner.request);
    expect(labels).toHaveLength(1);
    expect(labels[0]?.ticketCount).toBe(2);
  });
});

describe("Managing Labels", () => {
  it("lists every Label by name with its count of live Tickets", async () => {
    const t = buildTestApp();
    const { owner, member } = await setup(t);
    const as = owner.request;
    await createTicket(as, { projectKey: "CB", title: "A", labels: ["web", "api"] });
    await createTicket(as, { projectKey: "WEB", title: "B", labels: ["API"] });
    await createTicket(as, { projectKey: "CB", title: "C", labels: ["Zeta", "api"] });
    await as("/api/tickets/CB-2/archive", { method: "POST" });

    const labels = await companyLabels(member.request);

    expect(labels.map((l) => [l.name, l.ticketCount])).toEqual([
      ["api", 2],
      ["web", 1],
      ["Zeta", 0],
    ]);
  });

  for (const role of ["owner", "admin"] as const) {
    it(`lets an ${role} rename and recolor, and every Ticket shows the change`, async () => {
      const t = buildTestApp();
      const s = await setup(t);
      const as = s[role].request;
      const { labels } = await createTicket(s.owner.request, {
        projectKey: "CB",
        title: "A",
        labels: ["aip"],
      });
      const id = labels[0]?.id;

      const renamed = await as(`/api/labels/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "api", color: "violet" }),
      });

      expect(renamed.status).toBe(200);
      expect(await renamed.json()).toMatchObject({
        label: { id, name: "api", color: "violet", ticketCount: 1 },
      });
      const { ticket } = (await (await s.member.request("/api/tickets/CB-1")).json()) as {
        ticket: { labels: unknown };
      };
      expect(ticket.labels).toEqual([{ id, name: "api", color: "violet" }]);
      // Renaming records no Activity: the Ticket's set is unchanged.
      const kinds = (await activityOf(as, "CB-1")).map((a) => a.kind);
      expect(kinds).toEqual(["ticket.created"]);
    });
  }

  it("refuses a rename onto another Label's name, but allows another case of its own", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    const as = owner.request;
    const { labels } = await createTicket(as, {
      projectKey: "CB",
      title: "A",
      labels: ["api", "web"],
    });
    const [api, web] = labels;

    const taken = await as(`/api/labels/${web?.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "API" }),
    });
    const recased = await as(`/api/labels/${api?.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "API" }),
    });

    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "A label named api already exists." });
    expect(recased.status).toBe(200);
    expect(await labelsOn(as, "CB-1")).toEqual(["API", "web"]);
  });

  it("refuses colors outside the palette", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    const { labels } = await createTicket(owner.request, {
      projectKey: "CB",
      title: "A",
      labels: ["api"],
    });

    const res = await owner.request(`/api/labels/${labels[0]?.id}`, {
      method: "PATCH",
      body: JSON.stringify({ color: "chartreuse" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Pick one of the label colors." });
  });

  it("forbids members and Agents from renaming, recoloring, or deleting", async () => {
    const t = buildTestApp();
    const { owner, member, bearer } = await setup(t);
    const { labels } = await createTicket(owner.request, {
      projectKey: "CB",
      title: "A",
      labels: ["api"],
    });
    const path = `/api/labels/${labels[0]?.id}`;

    for (const [as, error] of [
      [member.request, "You don't have permission to do that."],
      [bearer, "Agents can't change labels."],
    ] as const) {
      const renamed = await as(path, { method: "PATCH", body: JSON.stringify({ name: "x" }) });
      const deleted = await as(path, { method: "DELETE" });
      for (const res of [renamed, deleted]) {
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error });
      }
    }
    expect(await labelsOn(owner.request, "CB-1")).toEqual(["api"]);
  });

  it("deletes a Label from every Ticket, recording the removal on each, archived ones too", async () => {
    const t = buildTestApp();
    const { admin, owner } = await setup(t);
    const as = owner.request;
    const { labels } = await createTicket(as, {
      projectKey: "CB",
      title: "A",
      labels: ["api", "web"],
    });
    await createTicket(as, { projectKey: "WEB", title: "B", labels: ["api"] });
    await createTicket(as, { projectKey: "CB", title: "C", labels: ["web"] });
    await as("/api/tickets/WEB-1/archive", { method: "POST" });
    const api = labels.find((l) => l.name === "api");

    const res = await admin.request(`/api/labels/${api?.id}`, { method: "DELETE" });

    expect(res.status).toBe(204);
    expect((await companyLabels(as)).map((l) => l.name)).toEqual(["web"]);
    expect(await labelsOn(as, "CB-1")).toEqual(["web"]);
    expect(await labelsOn(as, "WEB-1")).toEqual([]);
    for (const [key, from, to] of [
      ["CB-1", ["api", "web"], ["web"]],
      ["WEB-1", ["api"], []],
    ] as const) {
      const last = (await activityOf(as, key)).at(-1);
      expect(last, key).toMatchObject({
        kind: "ticket.updated",
        actor: { type: "user" },
        payload: { changes: { labels: { from, to } } },
      });
    }
    expect((await activityOf(as, "CB-2")).map((a) => a.kind)).toEqual(["ticket.created"]);
    expect((await admin.request(`/api/labels/${api?.id}`, { method: "DELETE" })).status).toBe(404);
  });
});

describe("Labels and Progress on the live stream", () => {
  it("delivers ticket.updated with the new Labels and Progress in the snapshot", async () => {
    const t = buildTestApp();
    const { owner, admin, bearer } = await setup(t);
    await createTicket(owner.request, { projectKey: "CB", title: "A" });
    const stream = await openStream(owner.request);

    await patch(bearer, "CB-1", { labels: ["api"], progress: 30 });
    const changed = JSON.parse((await stream.nextEvent()).data);
    const { labels } = (await (await owner.request("/api/labels")).json()) as {
      labels: LabelJson[];
    };
    await admin.request(`/api/labels/${labels[0]?.id}`, { method: "DELETE" });
    const removed = JSON.parse((await stream.nextEvent()).data);
    await stream.close();

    expect(changed).toMatchObject({
      activity: { kind: "ticket.updated", ticketKey: "CB-1" },
      ticket: { progress: 30, labels: [{ name: "api" }] },
    });
    expect(removed).toMatchObject({
      activity: { kind: "ticket.updated", payload: { changes: { labels: { to: [] } } } },
      ticket: { progress: 30, labels: [] },
    });
  });
});
