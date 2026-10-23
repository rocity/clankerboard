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

/** Acme with Project CB, as its owner and as Agent Claude-1. */
async function setup(t: TestApp) {
  const { owner } = await createCompany(t, { name: "Acme" });
  const agent = await createAgent(owner, "Claude-1");
  const { bearer } = await createApiKey(t, owner, agent.id);
  await createProject(owner.request, { name: "Board", key: "CB" });
  return { owner, agent, bearer };
}

const actors = [
  { name: "a User", as: (s: Awaited<ReturnType<typeof setup>>): Fetch => s.owner.request },
  { name: "an Agent", as: (s: Awaited<ReturnType<typeof setup>>): Fetch => s.bearer },
];

const patch = (as: Fetch, key: string, body: object) =>
  as(`/api/tickets/${key}`, { method: "PATCH", body: JSON.stringify(body) });

async function progressOf(as: Fetch, key: string) {
  const res = await as(`/api/tickets/${key}`);
  return ((await res.json()) as { ticket: { progress: number | null } }).ticket.progress;
}

describe("Progress over REST", () => {
  for (const actor of actors) {
    describe(`as ${actor.name}`, () => {
      it("is blank on a new Ticket unless one is given", async () => {
        const t = buildTestApp();
        const as = actor.as(await setup(t));

        const blank = await createTicket(as, { projectKey: "CB", title: "Not started" });
        const begun = await createTicket(as, { projectKey: "CB", title: "Begun", progress: 20 });

        expect(blank).toMatchObject({ progress: null });
        expect(begun).toMatchObject({ progress: 20 });
        expect(await progressOf(as, "CB-1")).toBeNull();
        expect(await progressOf(as, "CB-2")).toBe(20);
      });

      it("sets, changes, and clears it, keeping 0 distinct from blank", async () => {
        const t = buildTestApp();
        const as = actor.as(await setup(t));
        await createTicket(as, { projectKey: "CB", title: "Moving along" });

        const returned = [];
        for (const progress of [40, 70, 0, null]) {
          const res = await patch(as, "CB-1", { progress });
          expect(res.status).toBe(200);
          returned.push(((await res.json()) as { ticket: { progress: unknown } }).ticket.progress);
        }

        expect(returned).toEqual([40, 70, 0, null]);
        expect(await progressOf(as, "CB-1")).toBeNull();
      });

      it("records each change in the ticket.updated diff, credited to the Actor", async () => {
        const t = buildTestApp();
        const s = await setup(t);
        const as = actor.as(s);
        await createTicket(as, { projectKey: "CB", title: "Moving along" });

        for (const progress of [40, 70, 0, null]) await patch(as, "CB-1", { progress });
        await patch(as, "CB-1", { progress: null });

        const updates = (await activityOf(as, "CB-1")).filter((a) => a.kind === "ticket.updated");
        const credited = as === s.bearer ? { type: "agent", id: s.agent.id } : { type: "user" };
        expect(updates).toMatchObject(
          [
            { from: null, to: 40 },
            { from: 40, to: 70 },
            { from: 70, to: 0 },
            { from: 0, to: null },
          ].map((progress) => ({ actor: credited, payload: { changes: { progress } } })),
        );
      });

      it("refuses fractional, negative, over-100, and non-number Progress", async () => {
        const t = buildTestApp();
        const as = actor.as(await setup(t));
        await createTicket(as, { projectKey: "CB", title: "Begun", progress: 20 });

        for (const progress of [12.5, -1, 101, "40", true]) {
          const created = await as("/api/tickets", {
            method: "POST",
            body: JSON.stringify({ projectKey: "CB", title: "X", type: "task", progress }),
          });
          const updated = await patch(as, "CB-1", { progress });

          for (const res of [created, updated]) {
            expect(res.status, String(progress)).toBe(400);
            expect(await res.json()).toEqual({
              error: "Progress is a whole number from 0 to 100.",
            });
          }
        }
        expect(await progressOf(as, "CB-1")).toBe(20);
      });

      it("leaves Progress alone when the Ticket moves, Done included", async () => {
        const t = buildTestApp();
        const as = actor.as(await setup(t));
        await createTicket(as, { projectKey: "CB", title: "Halfway", progress: 50 });

        for (const status of ["in_progress", "review", "done", "todo"]) {
          const res = await as("/api/tickets/CB-1/move", {
            method: "POST",
            body: JSON.stringify({ status }),
          });
          expect(res.status, status).toBe(200);
          expect(await progressOf(as, "CB-1"), status).toBe(50);
        }
      });
    });
  }

  it("keeps the Progress through archive and restore", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    const as = owner.request;
    await createTicket(as, { projectKey: "CB", title: "Shelved", progress: 80 });

    expect((await as("/api/tickets/CB-1/archive", { method: "POST" })).status).toBe(200);
    expect(await progressOf(as, "CB-1")).toBe(80);
    expect((await as("/api/tickets/CB-1/restore", { method: "POST" })).status).toBe(200);

    expect(await progressOf(as, "CB-1")).toBe(80);
  });
});

// MCP is the Agent's door, so a User's side is checked over REST.
describe("Progress over MCP", () => {
  async function connect(t: TestApp) {
    const s = await setup(t);
    const { secret } = await createApiKey(t, s.owner, s.agent.id);
    return { ...s, client: await t.mcpClient(secret) };
  }

  it("describes progress on create_ticket and update_ticket, and asks Agents to keep it current", async () => {
    const t = buildTestApp();
    const { client } = await connect(t);

    const { tools } = await client.listTools();

    for (const name of ["create_ticket", "update_ticket"]) {
      const schema = tools.find((tool) => tool.name === name)?.inputSchema as {
        properties: Record<string, { description?: string }>;
      };
      expect(schema.properties.progress?.description, name).toBe(
        "How far along the work is, from 0 to 100, or null to leave it blank. Update it as you work.",
      );
    }
    expect(tools.find((tool) => tool.name === "update_ticket")?.description).toContain(
      "update its progress",
    );
  });

  it("sets, changes, and clears it from create_ticket and update_ticket, credited to the Agent", async () => {
    const t = buildTestApp();
    const { owner, agent, client } = await connect(t);

    const created = await client.callTool({
      name: "create_ticket",
      arguments: { projectKey: "CB", type: "task", title: "Begun", progress: 10 },
    });
    expect(created.structuredContent).toMatchObject({ ticket: { key: "CB-1", progress: 10 } });

    const returned = [];
    for (const progress of [60, null]) {
      const result = await client.callTool({
        name: "update_ticket",
        arguments: { key: "CB-1", progress },
      });
      expect(result.isError).toBeFalsy();
      returned.push(
        (result.structuredContent as { ticket: { progress: unknown } }).ticket.progress,
      );
    }

    expect(returned).toEqual([60, null]);
    expect(await progressOf(owner.request, "CB-1")).toBeNull();
    const updates = (await activityOf(owner.request, "CB-1")).filter(
      (a) => a.kind === "ticket.updated",
    );
    expect(updates).toMatchObject([
      {
        actor: { type: "agent", id: agent.id },
        payload: { changes: { progress: { from: 10, to: 60 } } },
      },
      {
        actor: { type: "agent", id: agent.id },
        payload: { changes: { progress: { from: 60, to: null } } },
      },
    ]);
  });

  it("refuses an out-of-range Progress with the plain message", async () => {
    const t = buildTestApp();
    const { owner, client } = await connect(t);
    await createTicket(owner.request, { projectKey: "CB", title: "Begun", progress: 20 });

    for (const [name, args] of [
      ["create_ticket", { projectKey: "CB", type: "task", title: "X", progress: 101 }],
      ["update_ticket", { key: "CB-1", progress: 33.3 }],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });

      expect(result.isError, name).toBe(true);
      expect(textOf(result)).toContain("Progress is a whole number from 0 to 100.");
    }
    expect(await progressOf(owner.request, "CB-1")).toBe(20);
  });

  it("shows the Progress in get_ticket, list_tickets, and the board", async () => {
    const t = buildTestApp();
    const { owner, client } = await connect(t);
    const as = owner.request;
    await createTicket(as, { projectKey: "CB", title: "Plan it", type: "epic", progress: 40 });
    await createTicket(as, { projectKey: "CB", title: "Unreported", parentKey: "CB-1" });
    await createTicket(as, {
      projectKey: "CB",
      title: "Just begun",
      parentKey: "CB-1",
      progress: 0,
    });

    const got = await client.callTool({ name: "get_ticket", arguments: { key: "CB-1" } });
    const listed = await client.callTool({ name: "list_tickets", arguments: {} });
    const board = await client.readResource({ uri: "agentkanban://projects/CB/board" });

    expect(got.structuredContent).toMatchObject({
      ticket: { progress: 40 },
      children: [
        { key: "CB-2", progress: null },
        { key: "CB-3", progress: 0 },
      ],
    });
    expect(textOf(got)).toContain("- Progress: 40%");
    expect(textOf(got)).toContain("**CB-2** [task, Backlog, medium] Unreported");
    expect(textOf(got)).toContain("**CB-3** [task, Backlog, medium, 0% done] Just begun");
    expect(listed.structuredContent).toMatchObject({
      tickets: [
        { key: "CB-1", progress: 40 },
        { key: "CB-2", progress: null },
        { key: "CB-3", progress: 0 },
      ],
    });
    expect(textOf(listed)).toContain("**CB-1** [epic, Backlog, medium, 40% done] Plan it");
    const boardText = (board.contents[0] as { text: string }).text;
    expect(boardText).toContain("- **CB-1** [epic, medium, 40% done] Plan it");
    expect(boardText).toContain("- **CB-2** [task, medium] Unreported");
  });

  it("says a Ticket without Progress has none in get_ticket", async () => {
    const t = buildTestApp();
    const { owner, client } = await connect(t);
    await createTicket(owner.request, { projectKey: "CB", title: "Unreported" });

    const got = await client.callTool({ name: "get_ticket", arguments: { key: "CB-1" } });

    expect(got.structuredContent).toMatchObject({ ticket: { progress: null } });
    expect(textOf(got)).toContain("- Progress: none");
  });
});

function textOf(result: { content?: unknown }) {
  const content = result.content as { type: string; text?: string }[];
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
