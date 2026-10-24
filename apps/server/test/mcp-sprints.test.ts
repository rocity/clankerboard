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

/** Acme with Project CB, its owner, and Agent Claude-1 connected over MCP. */
async function connect(t: TestApp) {
  const { owner } = await createCompany(t, { name: "Acme" });
  const agent = await createAgent(owner, "Claude-1");
  const { secret } = await createApiKey(t, owner, agent.id);
  await createProject(owner.request, { name: "Board", key: "CB" });
  return { owner, agent, client: await t.mcpClient(secret) };
}

function textOf(result: { content?: unknown }) {
  const content = result.content as { type: string; text?: string }[];
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

const post = (as: Fetch, path: string, body: object = {}) =>
  as(path, { method: "POST", body: JSON.stringify(body) });

async function newSprint(as: Fetch, goal?: string) {
  const res = await post(as, "/api/projects/CB/sprints", goal ? { goal } : {});
  expect(res.status).toBe(201);
}

const boardText = async (client: Awaited<ReturnType<typeof connect>>["client"]) => {
  const board = await client.readResource({ uri: "agentkanban://projects/CB/board" });
  return (board.contents[0] as { text: string }).text;
};

describe("Sprints over MCP", () => {
  it("lists a Project's Sprints with their state, goal, end date, and counts", async () => {
    const t = buildTestApp();
    const { owner, client } = await connect(t);

    const none = await client.callTool({ name: "list_sprints", arguments: { projectKey: "CB" } });
    expect(textOf(none)).toBe("## CB sprints\n\nCB has no sprints. Its board shows every ticket.");

    await newSprint(owner.request, "Ship login");
    await newSprint(owner.request);
    await post(owner.request, "/api/projects/CB/sprints/1/start", { endsOn: "2026-01-15" });
    await createTicket(owner.request, { projectKey: "CB", title: "A", sprint: 1, estimate: 3 });

    const listed = await client.callTool({ name: "list_sprints", arguments: { projectKey: "CB" } });

    expect(listed.structuredContent).toEqual({
      sprints: [
        {
          number: 1,
          goal: "Ship login",
          state: "active",
          startedAt: "2026-01-01T00:00:00.000Z",
          endsOn: "2026-01-15",
          finishedAt: null,
          ticketCount: 1,
          doneCount: 0,
          points: 3,
        },
        expect.objectContaining({ number: 2, state: "planned", endsOn: null }),
      ],
    });
    expect(textOf(listed)).toBe(
      [
        "## CB sprints",
        "",
        "- **Sprint 1** [active, ends 2026-01-15, 1 ticket, 0 done, 3 pts] Goal: Ship login",
        "- **Sprint 2** [planned, 0 tickets, 0 done, 0 pts]",
      ].join("\n"),
    );
  });

  it("puts Tickets in Sprints from create_ticket and update_ticket, credited to the Agent", async () => {
    const t = buildTestApp();
    const { owner, agent, client } = await connect(t);
    await newSprint(owner.request);
    await newSprint(owner.request);

    const created = await client.callTool({
      name: "create_ticket",
      arguments: { projectKey: "CB", type: "task", title: "Login", sprint: 1 },
    });
    const moved = await client.callTool({
      name: "update_ticket",
      arguments: { key: "cb-1", sprint: 2 },
    });
    const refused = await client.callTool({
      name: "update_ticket",
      arguments: { key: "CB-1", sprint: 7 },
    });

    expect(created.structuredContent).toMatchObject({
      ticket: { key: "CB-1", sprint: { number: 1, state: "planned" } },
    });
    expect(textOf(created)).toContain("- Sprint: Sprint 1 (planned)");
    expect(moved.structuredContent).toMatchObject({ ticket: { sprint: 2 } });
    expect(refused).toMatchObject({ isError: true, content: [{ text: "CB has no Sprint 7." }] });
    expect((await activityOf(owner.request, "CB-1")).at(-1)).toMatchObject({
      kind: "ticket.updated",
      actor: { type: "agent", id: agent.id },
      payload: { changes: { sprint: { from: 1, to: 2 } } },
    });
  });

  it("filters list_tickets by the active Sprint, no Sprint, or a number, and shows the Sprint in lines", async () => {
    const t = buildTestApp();
    const { owner, client } = await connect(t);
    await newSprint(owner.request);
    await newSprint(owner.request);
    await post(owner.request, "/api/projects/CB/sprints/1/start");
    await createTicket(owner.request, { projectKey: "CB", title: "Now", sprint: 1 });
    await createTicket(owner.request, { projectKey: "CB", title: "Next", sprint: 2 });
    await createTicket(owner.request, { projectKey: "CB", title: "Someday" });
    const keys = async (sprint: unknown) => {
      const result = await client.callTool({ name: "list_tickets", arguments: { sprint } });
      return (result.structuredContent as { tickets: { key: string }[] }).tickets.map((t) => t.key);
    };

    expect(await keys("active")).toEqual(["CB-1"]);
    expect(await keys("none")).toEqual(["CB-3"]);
    expect(await keys(2)).toEqual(["CB-2"]);
    const all = await client.callTool({ name: "list_tickets", arguments: {} });
    expect(textOf(all)).toContain("**CB-1** [task, Backlog, medium, sprint 1] Now (unassigned)");
    expect(textOf(all)).toContain("**CB-3** [task, Backlog, medium] Someday (unassigned)");
    expect(all.structuredContent).toMatchObject({
      tickets: [{ sprint: 1 }, { sprint: 2 }, { sprint: null }],
    });
    const bad = await client.callTool({ name: "list_tickets", arguments: { sprint: "soon" } });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain("Filter sprints by active, none, or a sprint number.");
  });

  it("shows only the active Sprint on the board resource, or says none is active", async () => {
    const t = buildTestApp();
    const { owner, client } = await connect(t);
    await createTicket(owner.request, { projectKey: "CB", title: "Someday" });
    expect(await boardText(client)).toContain("- **CB-1** [task, medium] Someday (unassigned)");

    await newSprint(owner.request, "Ship login");
    expect(await boardText(client)).toBe(
      "# CB board: Board\n\nNo sprint is active, so the board is empty. See list_sprints.",
    );

    await post(owner.request, "/api/projects/CB/sprints/1/start", { endsOn: "2026-01-15" });
    await createTicket(owner.request, { projectKey: "CB", title: "Now", sprint: 1 });
    const text = await boardText(client);
    expect(text).toContain(
      "# CB board: Board\n\nSprint 1 is active and ends 2026-01-15. Goal: Ship login\n\n## Backlog",
    );
    expect(text).toContain("- **CB-2** [task, medium, sprint 1] Now (unassigned)");
    expect(text).not.toContain("Someday");
  });

  it("offers no tool that changes a Sprint itself", async () => {
    const t = buildTestApp();
    const { client } = await connect(t);

    const { tools } = await client.listTools();

    const sprintTools = tools.map((tool) => tool.name).filter((name) => name.includes("sprint"));
    expect(sprintTools).toEqual(["list_sprints"]);
    expect(tools.find((tool) => tool.name === "list_sprints")?.annotations).toMatchObject({
      readOnlyHint: true,
    });
  });
});
