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

const types = ["epic", "story", "task", "bug"] as const;
type Type = (typeof types)[number];

const allowed: Record<Type, Type[]> = {
  epic: [],
  story: ["epic"],
  task: ["epic", "story"],
  bug: ["epic"],
};

async function setup(t: TestApp) {
  const { owner } = await createCompany(t, { name: "Acme" });
  const agent = await createAgent(owner, "Claude-1");
  const { bearer } = await createApiKey(t, owner, agent.id);
  await createProject(owner.request, { name: "Board", key: "CB" });
  return { owner, bearer };
}

function createRaw(as: Fetch, body: object) {
  return as("/api/tickets", {
    method: "POST",
    body: JSON.stringify({ projectKey: "CB", ...body }),
  });
}

describe("Ticket hierarchy", () => {
  const pairs = types.flatMap((child) => types.map((parent) => [child, parent] as const));

  it.each(pairs)("a %s under a %s", async (child, parent) => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t);
    const parentTicket = await createTicket(owner.request, {
      projectKey: "CB",
      title: "Parent",
      type: parent,
    });
    const ok = allowed[child].includes(parent);

    const created = await createRaw(bearer, {
      title: "Child",
      type: child,
      parentKey: parentTicket.key,
    });
    const loose = await createTicket(owner.request, {
      projectKey: "CB",
      title: "Loose",
      type: child,
    });
    const moved = await bearer(`/api/tickets/${loose.key}`, {
      method: "PATCH",
      body: JSON.stringify({ parentKey: parentTicket.key }),
    });

    expect([created.status, moved.status]).toEqual(ok ? [201, 200] : [400, 400]);
    if (ok) {
      expect(await created.json()).toMatchObject({
        ticket: { parent: { key: parentTicket.key, type: parent } },
      });
    } else {
      const message =
        child === "epic"
          ? "An epic can't have a parent."
          : `A ${child} can't sit under ${parent === "epic" ? "an" : "a"} ${parent}.`;
      expect(await created.json()).toEqual({ error: message });
    }
  });

  it("rejects a Parent in another Project", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await createProject(owner.request, { name: "Mobile", key: "MOB" });
    const epic = await createTicket(owner.request, { projectKey: "MOB", title: "E", type: "epic" });

    const res = await createRaw(owner.request, {
      title: "S",
      type: "story",
      parentKey: epic.key,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "A parent must be in the same project." });
  });

  it("returns not-found for a Parent in another Company", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    const globex = await createCompany(t, { name: "Globex" });
    await createProject(globex.owner.request, { name: "Theirs", key: "GX" });
    const theirs = await createTicket(globex.owner.request, {
      projectKey: "GX",
      title: "E",
      type: "epic",
    });

    const res = await createRaw(owner.request, {
      title: "S",
      type: "story",
      parentKey: theirs.key,
    });

    expect(res.status).toBe(404);
  });

  it("refuses a type change that would break existing children", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    const epic = await createTicket(owner.request, { projectKey: "CB", title: "E", type: "epic" });
    const story = await createTicket(owner.request, {
      projectKey: "CB",
      title: "S",
      type: "story",
      parentKey: epic.key,
    });

    const res = await owner.request(`/api/tickets/${epic.key}`, {
      method: "PATCH",
      body: JSON.stringify({ type: "task" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: `${story.key} is a story and can't sit under a task.`,
    });
  });

  it("counts archived children when checking a type change", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    const epic = await createTicket(owner.request, { projectKey: "CB", title: "E", type: "epic" });
    const story = await createTicket(owner.request, {
      projectKey: "CB",
      title: "S",
      type: "story",
      parentKey: epic.key,
    });
    await owner.request(`/api/tickets/${story.key}/archive`, { method: "POST" });

    const res = await owner.request(`/api/tickets/${epic.key}`, {
      method: "PATCH",
      body: JSON.stringify({ type: "task" }),
    });

    expect(res.status).toBe(400);
  });

  it("lists archived children on request", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    const epic = await createTicket(owner.request, { projectKey: "CB", title: "E", type: "epic" });
    const story = await createTicket(owner.request, {
      projectKey: "CB",
      title: "S",
      type: "story",
      parentKey: epic.key,
    });
    await owner.request(`/api/tickets/${story.key}/archive`, { method: "POST" });
    const keysOf = async (query: string) => {
      const res = await owner.request(`/api/tickets/${epic.key}/children${query}`);
      return ((await res.json()) as { children: { key: string }[] }).children.map((c) => c.key);
    };

    expect(await keysOf("")).toEqual([]);
    expect(await keysOf("?archived=include")).toEqual([story.key]);
  });

  it("refuses a type change that would break the Ticket's own Parent", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    const story = await createTicket(owner.request, {
      projectKey: "CB",
      title: "S",
      type: "story",
    });
    const task = await createTicket(owner.request, {
      projectKey: "CB",
      title: "T",
      type: "task",
      parentKey: story.key,
    });

    const res = await owner.request(`/api/tickets/${task.key}`, {
      method: "PATCH",
      body: JSON.stringify({ type: "bug" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "A bug can't sit under a story." });
  });

  it("allows a type change the hierarchy still accepts", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    const epic = await createTicket(owner.request, { projectKey: "CB", title: "E", type: "epic" });
    const task = await createTicket(owner.request, {
      projectKey: "CB",
      title: "T",
      type: "task",
      parentKey: epic.key,
    });

    const res = await owner.request(`/api/tickets/${task.key}`, {
      method: "PATCH",
      body: JSON.stringify({ type: "bug" }),
    });

    expect(res.status).toBe(200);
  });

  it("records setting and clearing a Parent as Activity", async () => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t);
    const epic = await createTicket(owner.request, { projectKey: "CB", title: "E", type: "epic" });
    const story = await createTicket(owner.request, {
      projectKey: "CB",
      title: "S",
      type: "story",
    });

    await bearer(`/api/tickets/${story.key}`, {
      method: "PATCH",
      body: JSON.stringify({ parentKey: epic.key }),
    });
    await bearer(`/api/tickets/${story.key}`, {
      method: "PATCH",
      body: JSON.stringify({ parentKey: null }),
    });

    const res = await owner.request(`/api/tickets/${story.key}/activity`);
    const { activity } = (await res.json()) as {
      activity: { kind: string; payload: { changes?: object } }[];
    };
    expect(activity.slice(1).map((a) => a.payload.changes)).toEqual([
      { parent: { from: null, to: epic.key } },
      { parent: { from: epic.key, to: null } },
    ]);
    expect(await (await owner.request(`/api/tickets/${story.key}`)).json()).toMatchObject({
      ticket: { parent: null },
    });
  });

  it("lists a Ticket's children", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    const epic = await createTicket(owner.request, { projectKey: "CB", title: "E", type: "epic" });
    const one = await createTicket(owner.request, {
      projectKey: "CB",
      title: "One",
      type: "story",
      parentKey: epic.key,
    });
    await createTicket(owner.request, { projectKey: "CB", title: "Loose", type: "task" });
    const two = await createTicket(owner.request, {
      projectKey: "CB",
      title: "Two",
      type: "bug",
      parentKey: epic.key,
    });

    const res = await owner.request(`/api/tickets/${epic.key}/children`);

    const { children } = (await res.json()) as { children: { key: string }[] };
    expect(children.map((c) => c.key)).toEqual([one.key, two.key]);
  });
});
