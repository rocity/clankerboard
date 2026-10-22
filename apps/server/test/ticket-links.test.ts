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
  const created = [];
  for (let i = 1; i <= count; i++) {
    created.push(await createTicket(as, { projectKey: "CB", title: `Task ${i}` }));
  }
  return created;
}

function link(as: Fetch, key: string, kind: string, target: string) {
  return as(`/api/tickets/${key}/links`, {
    method: "POST",
    body: JSON.stringify({ kind, target }),
  });
}

type LinkJson = { kind: string; key: string; archived: boolean };

/** A Ticket's Links as [kind, key] pairs, in the order the API lists them. */
async function linksOf(as: Fetch, key: string) {
  const res = await as(`/api/tickets/${key}/links`);
  if (res.status !== 200) throw new Error(`links failed: ${await res.text()}`);
  const { links } = (await res.json()) as { links: LinkJson[] };
  return links.map((l) => [l.kind, l.key]);
}

describe("Ticket Links", () => {
  it("links one Ticket as blocking another and returns the Link as seen from it", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await tasks(owner.request, 2);

    const res = await link(owner.request, "CB-1", "blocks", "CB-2");

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      link: {
        kind: "blocks",
        key: "CB-2",
        projectKey: "CB",
        title: "Task 2",
        type: "task",
        status: "backlog",
        archived: false,
        createdBy: { type: "user", id: owner.user.id, name: owner.user.name, revoked: false },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  const seenFromTarget = { blocks: "blocked_by", blocked_by: "blocks", relates_to: "relates_to" };
  const sides = (["user", "agent"] as const).flatMap((actor) =>
    (["blocks", "blocked_by", "relates_to"] as const).map((kind) => [actor, kind] as const),
  );

  it.each(sides)("links (%s) with %s and reads it from both Tickets", async (actor, kind) => {
    const t = buildTestApp();
    const { owner, agent, bearer } = await setup(t);
    await tasks(owner.request, 2);
    const as = actor === "user" ? owner.request : bearer;

    const res = await link(as, "CB-1", kind, "CB-2");

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      link: {
        kind,
        key: "CB-2",
        createdBy: actor === "user" ? { id: owner.user.id } : { id: agent.id },
      },
    });
    expect(await linksOf(as, "CB-1")).toEqual([[kind, "CB-2"]]);
    expect(await linksOf(as, "CB-2")).toEqual([[seenFromTarget[kind], "CB-1"]]);
  });

  type Rule = {
    rule: string;
    /** Links made first, as [key, kind, target]. */
    existing: [string, string, string][];
    archived?: string;
    attempt: [string, string, string];
    status: number;
    error: string;
  };
  const rules: Rule[] = [
    {
      rule: "a self-link",
      existing: [],
      attempt: ["CB-1", "blocks", "cb-1"],
      status: 400,
      error: "A ticket can't be linked to itself.",
    },
    {
      rule: "the same Link again",
      existing: [["CB-1", "blocks", "CB-2"]],
      attempt: ["CB-1", "blocks", "CB-2"],
      status: 409,
      error: "CB-1 already blocks CB-2.",
    },
    {
      rule: "the same Link from the other side",
      existing: [["CB-1", "blocks", "CB-2"]],
      attempt: ["CB-2", "blocked_by", "CB-1"],
      status: 409,
      error: "CB-1 already blocks CB-2.",
    },
    {
      rule: "a direct cycle",
      existing: [["CB-1", "blocks", "CB-2"]],
      attempt: ["CB-2", "blocks", "CB-1"],
      status: 409,
      error: "CB-1 already blocks CB-2.",
    },
    {
      rule: "another kind on a blocked pair",
      existing: [["CB-1", "blocks", "CB-2"]],
      attempt: ["CB-2", "relates_to", "CB-1"],
      status: 409,
      error: "CB-1 already blocks CB-2.",
    },
    {
      rule: "Blocks on a related pair",
      existing: [["CB-1", "relates_to", "CB-2"]],
      attempt: ["CB-2", "blocks", "CB-1"],
      status: 409,
      error: "CB-2 already relates to CB-1.",
    },
    {
      rule: "a three-step cycle",
      existing: [
        ["CB-1", "blocks", "CB-2"],
        ["CB-2", "blocks", "CB-3"],
      ],
      attempt: ["CB-3", "blocks", "CB-1"],
      status: 409,
      error: "CB-3 can't block CB-1 because CB-1 already blocks CB-3 through CB-2.",
    },
    {
      rule: "a cycle made from the blocked side",
      existing: [
        ["CB-1", "blocks", "CB-2"],
        ["CB-2", "blocks", "CB-3"],
        ["CB-3", "blocks", "CB-4"],
      ],
      attempt: ["CB-1", "blocked_by", "CB-4"],
      status: 409,
      error: "CB-4 can't block CB-1 because CB-1 already blocks CB-4 through CB-2 and CB-3.",
    },
    {
      rule: "a Link to an archived Ticket",
      existing: [],
      archived: "CB-2",
      attempt: ["CB-1", "relates_to", "CB-2"],
      status: 409,
      error: "Restore CB-2 before linking it.",
    },
    {
      rule: "a Link from an archived Ticket",
      existing: [],
      archived: "CB-1",
      attempt: ["CB-1", "blocks", "CB-2"],
      status: 409,
      error: "Restore CB-1 before linking it.",
    },
  ];
  const refusals = (["user", "agent"] as const).flatMap((actor) =>
    rules.map((rule) => [rule.rule, actor, rule] as const),
  );

  it.each(refusals)("refuses %s (%s)", async (_, actor, rule) => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t);
    await tasks(owner.request, 4);
    for (const [key, kind, target] of rule.existing) {
      expect((await link(owner.request, key, kind, target)).status).toBe(201);
    }
    if (rule.archived) {
      await owner.request(`/api/tickets/${rule.archived}/archive`, { method: "POST" });
    }
    const [key, kind, target] = rule.attempt;
    const before = await linksOf(owner.request, key);

    const res = await link(actor === "user" ? owner.request : bearer, key, kind, target);

    expect(res.status).toBe(rule.status);
    expect(await res.json()).toEqual({ error: rule.error });
    expect(await linksOf(owner.request, key)).toEqual(before);
  });

  it("refuses an unknown kind or a malformed target with a plain message", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await tasks(owner.request, 2);

    const badKind = await link(owner.request, "CB-1", "duplicates", "CB-2");
    const badTarget = await link(owner.request, "CB-1", "blocks", "two");

    expect(badKind.status).toBe(400);
    expect(await badKind.json()).toEqual({ error: "Pick blocks, blocked_by, or relates_to." });
    expect(badTarget.status).toBe(400);
    expect(await badTarget.json()).toEqual({ error: "Use a ticket key like CB-42." });
  });

  it("allows Blocks that join without a cycle, ignoring Relates to", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await tasks(owner.request, 4);
    await link(owner.request, "CB-1", "blocks", "CB-2");
    await link(owner.request, "CB-1", "blocks", "CB-3");
    await link(owner.request, "CB-2", "blocks", "CB-4");
    await link(owner.request, "CB-4", "relates_to", "CB-1");

    const res = await link(owner.request, "CB-3", "blocks", "CB-4");

    expect(res.status).toBe(201);
  });

  it("links Tickets in different Projects of the same Company", async () => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t);
    await createProject(owner.request, { name: "Web", key: "WEB" });
    await tasks(owner.request, 1);
    await createTicket(owner.request, { projectKey: "WEB", title: "Page" });

    const res = await link(bearer, "CB-1", "blocks", "WEB-1");

    expect(res.status).toBe(201);
    expect(await linksOf(owner.request, "WEB-1")).toEqual([["blocked_by", "CB-1"]]);
    expect(((await res.json()) as { link: { projectKey: string } }).link.projectKey).toBe("WEB");
  });

  it("returns not found for a Ticket in another Company", async () => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t);
    await tasks(owner.request, 1);
    const globex = await createCompany(t, { name: "Globex" });
    await createProject(globex.owner.request, { name: "Theirs", key: "GX" });
    await createTicket(globex.owner.request, { projectKey: "GX", title: "Theirs" });

    for (const as of [owner.request, bearer]) {
      expect((await link(as, "CB-1", "blocks", "GX-1")).status).toBe(404);
      expect((await link(as, "GX-1", "blocks", "CB-1")).status).toBe(404);
      expect((await as("/api/tickets/GX-1/links")).status).toBe(404);
      expect((await as("/api/tickets/CB-1/links/GX-1", { method: "DELETE" })).status).toBe(404);
    }
  });

  const removals = (["user", "agent"] as const).flatMap((actor) =>
    (["blocks", "blocked_by", "relates_to"] as const).flatMap((kind) =>
      (["CB-1", "CB-2"] as const).map((from) => [kind, from, actor] as const),
    ),
  );

  it.each(removals)("removes a %s Link from %s (%s)", async (kind, from, actor) => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t);
    await tasks(owner.request, 2);
    await link(owner.request, "CB-1", kind, "CB-2");
    const other = from === "CB-1" ? "CB-2" : "CB-1";

    const res = await (actor === "user" ? owner.request : bearer)(
      `/api/tickets/${from}/links/${other}`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(204);
    expect(await linksOf(owner.request, "CB-1")).toEqual([]);
    expect(await linksOf(owner.request, "CB-2")).toEqual([]);
  });

  it("returns not found when removing a Link that doesn't exist", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await tasks(owner.request, 2);

    const res = await owner.request("/api/tickets/CB-1/links/CB-2", { method: "DELETE" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "CB-1 and CB-2 aren't linked." });
  });

  it("removes a Link while one of its Tickets is archived", async () => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t);
    await tasks(owner.request, 2);
    await link(owner.request, "CB-1", "blocks", "CB-2");
    await owner.request("/api/tickets/CB-1/archive", { method: "POST" });

    const res = await bearer("/api/tickets/CB-1/links/CB-2", { method: "DELETE" });

    expect(res.status).toBe(204);
    expect(await linksOf(owner.request, "CB-2")).toEqual([]);
  });

  it("allows linking the pair again with a new kind after removing the Link", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await tasks(owner.request, 2);
    await link(owner.request, "CB-1", "blocks", "CB-2");
    await owner.request("/api/tickets/CB-2/links/CB-1", { method: "DELETE" });

    const res = await link(owner.request, "CB-2", "relates_to", "CB-1");

    expect(res.status).toBe(201);
    expect(await linksOf(owner.request, "CB-1")).toEqual([["relates_to", "CB-2"]]);
  });

  it.each([
    ["user", "blocks", "blocked_by"],
    ["agent", "blocked_by", "blocks"],
    ["agent", "relates_to", "relates_to"],
  ] as const)(
    "records linking and unlinking on both Tickets (%s, %s)",
    async (actor, kind, reverse) => {
      const t = buildTestApp();
      const { owner, agent, bearer } = await setup(t);
      await tasks(owner.request, 2);
      const as = actor === "user" ? owner.request : bearer;
      const actorId = actor === "user" ? owner.user.id : agent.id;

      await link(as, "CB-1", kind, "CB-2");
      await as("/api/tickets/CB-2/links/CB-1", { method: "DELETE" });

      // Blocked transitions are recorded too; blocked.test.ts covers those.
      const recorded = async (key: string) =>
        (await activityOf(owner.request, key))
          .filter((a) => a.kind === "ticket.linked" || a.kind === "ticket.unlinked")
          .map((a) => [a.kind, a.payload, a.actor.type, a.actor.id]);
      expect(await recorded("CB-1")).toEqual([
        ["ticket.linked", { kind, ticket: "CB-2" }, actor, actorId],
        ["ticket.unlinked", { kind, ticket: "CB-2" }, actor, actorId],
      ]);
      expect(await recorded("CB-2")).toEqual([
        ["ticket.linked", { kind: reverse, ticket: "CB-1" }, actor, actorId],
        ["ticket.unlinked", { kind: reverse, ticket: "CB-1" }, actor, actorId],
      ]);
    },
  );

  it("keeps Links through archive and restore", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await tasks(owner.request, 2);
    await link(owner.request, "CB-1", "blocks", "CB-2");

    await owner.request("/api/tickets/CB-1/archive", { method: "POST" });
    const whileArchived = await linksOf(owner.request, "CB-2");
    await owner.request("/api/tickets/CB-1/restore", { method: "POST" });

    expect(whileArchived).toEqual([["blocked_by", "CB-1"]]);
    expect(await linksOf(owner.request, "CB-1")).toEqual([["blocks", "CB-2"]]);
  });

  it("removes a hard-deleted Ticket's Links", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await tasks(owner.request, 3);
    await link(owner.request, "CB-1", "blocks", "CB-2");
    await link(owner.request, "CB-3", "relates_to", "CB-1");

    await owner.request("/api/tickets/CB-1", { method: "DELETE" });

    expect(await linksOf(owner.request, "CB-2")).toEqual([]);
    expect(await linksOf(owner.request, "CB-3")).toEqual([]);
  });

  it("lists Links blocked by first, then blocks, then relates to, marking archived ones", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await tasks(owner.request, 6);
    await link(owner.request, "CB-1", "relates_to", "CB-2");
    await link(owner.request, "CB-1", "blocks", "CB-3");
    await link(owner.request, "CB-1", "blocked_by", "CB-6");
    await link(owner.request, "CB-4", "relates_to", "CB-1");
    await link(owner.request, "CB-5", "blocks", "CB-1");
    await owner.request("/api/tickets/CB-5/archive", { method: "POST" });

    const res = await owner.request("/api/tickets/CB-1/links");

    const { links } = (await res.json()) as { links: LinkJson[] };
    expect(links.map((l) => [l.kind, l.key, l.archived])).toEqual([
      ["blocked_by", "CB-5", true],
      ["blocked_by", "CB-6", false],
      ["blocks", "CB-3", false],
      ["relates_to", "CB-2", false],
      ["relates_to", "CB-4", false],
    ]);
  });
});
