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

async function estimateOf(as: Fetch, key: string) {
  const res = await as(`/api/tickets/${key}`);
  return ((await res.json()) as { ticket: { estimate: number | null } }).ticket.estimate;
}

describe("Estimate over REST", () => {
  for (const actor of actors) {
    describe(`as ${actor.name}`, () => {
      it("is blank on a new Ticket unless one is given", async () => {
        const t = buildTestApp();
        const as = actor.as(await setup(t));

        const blank = await createTicket(as, { projectKey: "CB", title: "Unsized" });
        const sized = await createTicket(as, { projectKey: "CB", title: "Sized", estimate: 3 });

        expect(blank).toMatchObject({ estimate: null });
        expect(sized).toMatchObject({ estimate: 3 });
        expect(await estimateOf(as, "CB-1")).toBeNull();
        expect(await estimateOf(as, "CB-2")).toBe(3);
      });

      it("sets, changes, and clears it, keeping 0 distinct from blank", async () => {
        const t = buildTestApp();
        const as = actor.as(await setup(t));
        await createTicket(as, { projectKey: "CB", title: "Grows" });

        const steps = [3, 5, 0, null];
        const returned = [];
        for (const estimate of steps) {
          const res = await patch(as, "CB-1", { estimate });
          expect(res.status).toBe(200);
          returned.push(((await res.json()) as { ticket: { estimate: unknown } }).ticket.estimate);
        }

        expect(returned).toEqual([3, 5, 0, null]);
        expect(await estimateOf(as, "CB-1")).toBeNull();
      });

      it("records each change in the ticket.updated diff, credited to the Actor", async () => {
        const t = buildTestApp();
        const s = await setup(t);
        const as = actor.as(s);
        await createTicket(as, { projectKey: "CB", title: "Grows" });

        for (const estimate of [3, 5, 0, null]) await patch(as, "CB-1", { estimate });
        await patch(as, "CB-1", { estimate: null });

        const updates = (await activityOf(as, "CB-1")).filter((a) => a.kind === "ticket.updated");
        const credited = as === s.bearer ? { type: "agent", id: s.agent.id } : { type: "user" };
        expect(updates).toMatchObject(
          [
            { from: null, to: 3 },
            { from: 3, to: 5 },
            { from: 5, to: 0 },
            { from: 0, to: null },
          ].map((estimate) => ({ actor: credited, payload: { changes: { estimate } } })),
        );
      });

      it("refuses fractional, negative, over-100, and non-number Estimates", async () => {
        const t = buildTestApp();
        const as = actor.as(await setup(t));
        await createTicket(as, { projectKey: "CB", title: "Sized", estimate: 2 });

        for (const estimate of [1.5, -1, 101, "3", true]) {
          const created = await as("/api/tickets", {
            method: "POST",
            body: JSON.stringify({ projectKey: "CB", title: "X", type: "task", estimate }),
          });
          const updated = await patch(as, "CB-1", { estimate });

          for (const res of [created, updated]) {
            expect(res.status, String(estimate)).toBe(400);
            expect(await res.json()).toEqual({
              error: "Estimates are whole numbers from 0 to 100.",
            });
          }
        }
        expect(await estimateOf(as, "CB-1")).toBe(2);
      });
    });
  }

  it("keeps the Estimate through archive and restore", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    const as = owner.request;
    await createTicket(as, { projectKey: "CB", title: "Shelved", estimate: 8 });

    const archived = await as("/api/tickets/CB-1/archive", { method: "POST" });
    expect(archived.status).toBe(200);
    expect(await estimateOf(as, "CB-1")).toBe(8);
    const restored = await as("/api/tickets/CB-1/restore", { method: "POST" });
    expect(restored.status).toBe(200);

    expect(await estimateOf(as, "CB-1")).toBe(8);
  });
});

// MCP is the Agent's door, so a User's side is checked over REST.
describe("Estimate over MCP", () => {
  async function connect(t: TestApp) {
    const s = await setup(t);
    const { secret } = await createApiKey(t, s.owner, s.agent.id);
    return { ...s, client: await t.mcpClient(secret) };
  }

  it("describes estimate on create_ticket and update_ticket", async () => {
    const t = buildTestApp();
    const { client } = await connect(t);

    const { tools } = await client.listTools();

    for (const name of ["create_ticket", "update_ticket"]) {
      const schema = tools.find((tool) => tool.name === name)?.inputSchema as {
        properties: Record<string, { description?: string }>;
      };
      expect(schema.properties.estimate?.description, name).toBe(
        "Points from 0 to 100, or null to leave it blank.",
      );
    }
  });

  it("sets, changes, and clears it from create_ticket and update_ticket, credited to the Agent", async () => {
    const t = buildTestApp();
    const { owner, agent, client } = await connect(t);

    const created = await client.callTool({
      name: "create_ticket",
      arguments: { projectKey: "CB", type: "task", title: "Sized", estimate: 3 },
    });
    expect(created.structuredContent).toMatchObject({ ticket: { key: "CB-1", estimate: 3 } });
    expect(await estimateOf(owner.request, "CB-1")).toBe(3);

    const returned = [];
    for (const estimate of [0, null]) {
      const result = await client.callTool({
        name: "update_ticket",
        arguments: { key: "CB-1", estimate },
      });
      expect(result.isError).toBeFalsy();
      returned.push(
        (result.structuredContent as { ticket: { estimate: unknown } }).ticket.estimate,
      );
    }

    expect(returned).toEqual([0, null]);
    expect(await estimateOf(owner.request, "CB-1")).toBeNull();
    const updates = (await activityOf(owner.request, "CB-1")).filter(
      (a) => a.kind === "ticket.updated",
    );
    expect(updates).toMatchObject([
      {
        actor: { type: "agent", id: agent.id },
        payload: { changes: { estimate: { from: 3, to: 0 } } },
      },
      {
        actor: { type: "agent", id: agent.id },
        payload: { changes: { estimate: { from: 0, to: null } } },
      },
    ]);
  });

  it("refuses an out-of-range Estimate with the plain message", async () => {
    const t = buildTestApp();
    const { owner, client } = await connect(t);
    await createTicket(owner.request, { projectKey: "CB", title: "Sized", estimate: 2 });

    for (const [name, args] of [
      ["create_ticket", { projectKey: "CB", type: "task", title: "X", estimate: 101 }],
      ["update_ticket", { key: "CB-1", estimate: 1.5 }],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });

      expect(result.isError, name).toBe(true);
      expect(textOf(result)).toContain("Estimates are whole numbers from 0 to 100.");
    }
    expect(await estimateOf(owner.request, "CB-1")).toBe(2);
  });

  it("shows the Estimate in get_ticket, list_tickets, and the board", async () => {
    const t = buildTestApp();
    const { owner, client } = await connect(t);
    const as = owner.request;
    await createTicket(as, { projectKey: "CB", title: "Plan it", type: "epic", estimate: 13 });
    await createTicket(as, { projectKey: "CB", title: "Unsized", parentKey: "CB-1" });
    await createTicket(as, { projectKey: "CB", title: "Trivial", parentKey: "CB-1", estimate: 0 });

    const got = await client.callTool({ name: "get_ticket", arguments: { key: "CB-1" } });
    const listed = await client.callTool({ name: "list_tickets", arguments: {} });
    const board = await client.readResource({ uri: "clankerboard://projects/CB/board" });

    expect(got.structuredContent).toMatchObject({
      ticket: { estimate: 13 },
      children: [
        { key: "CB-2", estimate: null },
        { key: "CB-3", estimate: 0 },
      ],
    });
    expect(textOf(got)).toContain("- Estimate: 13 pts");
    expect(textOf(got)).toContain("**CB-2** [task, Backlog, medium] Unsized");
    expect(textOf(got)).toContain("**CB-3** [task, Backlog, medium, 0 pts] Trivial");
    expect(listed.structuredContent).toMatchObject({
      tickets: [
        { key: "CB-1", estimate: 13 },
        { key: "CB-2", estimate: null },
        { key: "CB-3", estimate: 0 },
      ],
    });
    expect(textOf(listed)).toContain("**CB-1** [epic, Backlog, medium, 13 pts] Plan it");
    expect(textOf(listed)).toContain("**CB-2** [task, Backlog, medium] Unsized");
    const boardText = (board.contents[0] as { text: string }).text;
    expect(boardText).toContain("- **CB-1** [epic, medium, 13 pts] Plan it");
    expect(boardText).toContain("- **CB-2** [task, medium] Unsized");
  });

  it("says a Ticket without an Estimate has none in get_ticket", async () => {
    const t = buildTestApp();
    const { owner, client } = await connect(t);
    await createTicket(owner.request, { projectKey: "CB", title: "Unsized" });

    const got = await client.callTool({ name: "get_ticket", arguments: { key: "CB-1" } });

    expect(got.structuredContent).toMatchObject({ ticket: { estimate: null } });
    expect(textOf(got)).toContain("- Estimate: none");
  });
});

function textOf(result: { content?: unknown }) {
  const content = result.content as { type: string; text?: string }[];
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
