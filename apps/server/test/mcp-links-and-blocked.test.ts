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

// MCP is the Agent's door, so the Agent acts over MCP and the User sets up over REST.

async function setup(t: TestApp) {
  const { owner } = await createCompany(t, { name: "Acme" });
  const agent = await createAgent(owner, "Claude-1");
  const { secret } = await createApiKey(t, owner, agent.id);
  await createProject(owner.request, { name: "Clankerboard", key: "CB" });
  const client = await t.mcpClient(secret);
  return { owner, agent, client };
}

/** Creates `count` tasks in CB, numbered from CB-1. */
async function tasks(as: Fetch, count: number) {
  for (let i = 1; i <= count; i++) {
    await createTicket(as, { projectKey: "CB", title: `Task ${i}` });
  }
}

type Linked = { kind: string; key: string; status: string; archived: boolean };

/** A Ticket's Links over REST, as `kind key` pairs. */
async function linksOf(as: Fetch, key: string) {
  const res = await as(`/api/tickets/${key}/links`);
  if (res.status !== 200) throw new Error(`links failed: ${await res.text()}`);
  const { links } = (await res.json()) as { links: Linked[] };
  return links.map((link) => `${link.kind} ${link.key}`);
}

/** The Markdown a tool returned. */
function textOf(result: { content?: unknown }) {
  const content = result.content as { type: string; text?: string }[];
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

describe("link_tickets and unlink_tickets", () => {
  it.each([
    ["blocks", ["blocks CB-2"], ["blocked_by CB-1"]],
    ["blocked_by", ["blocked_by CB-2"], ["blocks CB-1"]],
    ["relates_to", ["relates_to CB-2"], ["relates_to CB-1"]],
  ])("links and unlinks %s as an Agent", async (kind, fromSide, toSide) => {
    const t = buildTestApp();
    const { owner, client } = await setup(t);
    await tasks(owner.request, 2);

    const linked = await client.callTool({
      name: "link_tickets",
      arguments: { key: "cb-1", kind, target: "cb-2" },
    });

    expect(linked.isError).toBeFalsy();
    expect(await linksOf(owner.request, "CB-1")).toEqual(fromSide);
    expect(await linksOf(owner.request, "CB-2")).toEqual(toSide);
    const data = linked.structuredContent as { links: Linked[] };
    expect(data.links.map((link) => `${link.kind} ${link.key}`)).toEqual(fromSide);

    const unlinked = await client.callTool({
      name: "unlink_tickets",
      arguments: { key: "CB-2", target: "CB-1" },
    });

    expect(unlinked.isError).toBeFalsy();
    expect(await linksOf(owner.request, "CB-1")).toEqual([]);
    expect(await linksOf(owner.request, "CB-2")).toEqual([]);
    expect((unlinked.structuredContent as { links: Linked[] }).links).toEqual([]);
  });

  it("are non-destructive writes", async () => {
    const t = buildTestApp();
    const { client } = await setup(t);

    const { tools } = await client.listTools();

    for (const name of ["link_tickets", "unlink_tickets"]) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.annotations, name).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
      });
    }
  });

  it("confirms the change in Markdown, read from the requesting ticket", async () => {
    const t = buildTestApp();
    const { owner, client } = await setup(t);
    await tasks(owner.request, 2);

    const linked = await client.callTool({
      name: "link_tickets",
      arguments: { key: "CB-2", kind: "blocked_by", target: "CB-1" },
    });
    const unlinked = await client.callTool({
      name: "unlink_tickets",
      arguments: { key: "CB-1", target: "CB-2" },
    });

    expect(textOf(linked)).toContain("CB-2 is now blocked by CB-1.");
    expect(textOf(linked)).toContain("### Blocked by\n\n- **CB-1** [task, Backlog] Task 1");
    expect(textOf(unlinked)).toContain("CB-1 and CB-2 are no longer linked.");
    expect(textOf(unlinked)).toContain("No linked tickets.");
  });

  it("returns the domain's refusals as tool errors", async () => {
    const t = buildTestApp();
    const { owner, client } = await setup(t);
    await tasks(owner.request, 3);
    const link = (key: string, kind: string, target: string) =>
      client.callTool({ name: "link_tickets", arguments: { key, kind, target } });
    await link("CB-1", "blocks", "CB-2");
    await link("CB-2", "blocks", "CB-3");

    const refusals = [
      await link("CB-1", "relates_to", "CB-1"),
      await link("CB-2", "relates_to", "CB-1"),
      await link("CB-3", "blocks", "CB-1"),
      await link("CB-1", "blocks", "CB-99"),
      await client.callTool({ name: "unlink_tickets", arguments: { key: "CB-1", target: "CB-3" } }),
    ];

    expect(refusals.map((result) => [result.isError, textOf(result)])).toEqual([
      [true, "A ticket can't be linked to itself."],
      [true, "CB-1 already blocks CB-2."],
      [true, "CB-3 can't block CB-1 because CB-1 already blocks CB-3 through CB-2."],
      [true, "Not found."],
      [true, "CB-1 and CB-3 aren't linked."],
    ]);
  });
});

describe("get_ticket", () => {
  it("lists Links grouped as Blocked by, Blocks, and Related, each with Status", async () => {
    const t = buildTestApp();
    const { owner, client } = await setup(t);
    const as = owner.request;
    await createProject(as, { name: "Other", key: "OT" });
    await tasks(as, 4);
    await createTicket(as, { projectKey: "OT", title: "Elsewhere", type: "bug" }); // OT-1
    const link = (key: string, kind: string, target: string) =>
      client.callTool({ name: "link_tickets", arguments: { key, kind, target } });
    await link("CB-1", "relates_to", "OT-1");
    await link("CB-1", "blocks", "CB-3");
    await link("CB-1", "blocked_by", "CB-2");
    await link("CB-1", "blocked_by", "CB-4");
    await as("/api/tickets/CB-2/move", {
      method: "POST",
      body: JSON.stringify({ status: "done" }),
    });
    await as("/api/tickets/CB-4/archive", { method: "POST" });

    const result = await client.callTool({ name: "get_ticket", arguments: { key: "CB-1" } });

    expect(result.isError).toBeFalsy();
    const { links } = result.structuredContent as { links: Linked[] };
    expect(links.map((l) => [l.kind, l.key, l.status, l.archived])).toEqual([
      ["blocked_by", "CB-2", "done", false],
      ["blocked_by", "CB-4", "backlog", true],
      ["blocks", "CB-3", "backlog", false],
      ["relates_to", "OT-1", "backlog", false],
    ]);
    expect(textOf(result)).toContain(
      [
        "## Linked tickets",
        "",
        "### Blocked by",
        "",
        "- **CB-2** [task, Done] Task 2",
        "- **CB-4** [task, Backlog, archived] Task 4",
        "",
        "### Blocks",
        "",
        "- **CB-3** [task, Backlog] Task 3",
        "",
        "### Related",
        "",
        "- **OT-1** [bug, Backlog] Elsewhere",
      ].join("\n"),
    );
  });

  it("says when a ticket has no Links", async () => {
    const t = buildTestApp();
    const { owner, client } = await setup(t);
    await tasks(owner.request, 1);

    const result = await client.callTool({ name: "get_ticket", arguments: { key: "CB-1" } });

    expect((result.structuredContent as { links: Linked[] }).links).toEqual([]);
    expect(textOf(result)).toContain("## Linked tickets\n\nNo linked tickets.");
  });
});

describe("Blocked over MCP", () => {
  /**
   * Epic CB-1 over To Do tasks CB-2 to CB-5. CB-2 blocks CB-3, which is
   * Blocked. CB-4 blocks CB-5 but is Done, so CB-5 is not.
   */
  async function seed(as: Fetch) {
    await createTicket(as, { projectKey: "CB", title: "Epic", type: "epic" });
    for (let i = 2; i <= 5; i++) {
      await createTicket(as, { projectKey: "CB", title: `Task ${i}`, parentKey: "CB-1" });
      await call(as, `/api/tickets/CB-${i}/move`, { status: "todo" });
    }
    await call(as, "/api/tickets/CB-2/links", { kind: "blocks", target: "CB-3" });
    await call(as, "/api/tickets/CB-4/links", { kind: "blocks", target: "CB-5" });
    await call(as, "/api/tickets/CB-4/move", { status: "done" });
  }

  type Summary = { key: string; blocked: boolean };

  it("marks Blocked tickets in list_tickets", async () => {
    const t = buildTestApp();
    const { owner, client } = await setup(t);
    await seed(owner.request);

    const result = await client.callTool({ name: "list_tickets", arguments: { status: "todo" } });

    const { tickets } = result.structuredContent as { tickets: Summary[] };
    expect(tickets.map((ticket) => [ticket.key, ticket.blocked])).toEqual([
      ["CB-2", false],
      ["CB-3", true],
      ["CB-5", false],
    ]);
    expect(textOf(result)).toContain("**CB-3** [task, To Do, medium, blocked] Task 3 (unassigned)");
    expect(textOf(result)).toContain("**CB-2** [task, To Do, medium] Task 2 (unassigned)");
  });

  it("marks Blocked children in get_ticket, and the ticket itself", async () => {
    const t = buildTestApp();
    const { owner, client } = await setup(t);
    await seed(owner.request);

    const epic = await client.callTool({ name: "get_ticket", arguments: { key: "CB-1" } });
    const blocked = await client.callTool({ name: "get_ticket", arguments: { key: "CB-3" } });

    const { children } = epic.structuredContent as { children: Summary[] };
    expect(children.map((child) => [child.key, child.blocked])).toEqual([
      ["CB-2", false],
      ["CB-3", true],
      ["CB-4", false],
      ["CB-5", false],
    ]);
    expect(textOf(epic)).toContain("**CB-3** [task, To Do, medium, blocked] Task 3 (unassigned)");
    expect(textOf(epic)).not.toContain("- Blocked:");
    expect(textOf(blocked)).toContain("- Blocked: yes");
  });

  it("marks Blocked tickets on the board resource", async () => {
    const t = buildTestApp();
    const { owner, client } = await setup(t);
    await seed(owner.request);

    const result = await client.readResource({ uri: "clankerboard://projects/CB/board" });

    const text = (result.contents[0] as { text: string }).text;
    expect(text).toContain("- **CB-3** [task, medium, blocked] Task 3 (unassigned)");
    expect(text).toContain("- **CB-2** [task, medium] Task 2 (unassigned)");
  });

  it("filters list_tickets to only Blocked or only unblocked tickets", async () => {
    const t = buildTestApp();
    const { owner, client } = await setup(t);
    await seed(owner.request);
    const keys = async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name: "list_tickets", arguments: args });
      expect(result.isError).toBeFalsy();
      return (result.structuredContent as { tickets: Summary[] }).tickets.map((s) => s.key);
    };

    expect(await keys({ status: "todo", blocked: true })).toEqual(["CB-3"]);
    expect(await keys({ status: "todo", blocked: false })).toEqual(["CB-2", "CB-5"]);
    expect(await keys({ status: "todo" })).toEqual(["CB-2", "CB-3", "CB-5"]);
  });

  it("tells Agents to pass blocked: false when looking for work to claim", async () => {
    const t = buildTestApp();
    const { client } = await setup(t);

    const { tools } = await client.listTools();

    const list = tools.find((tool) => tool.name === "list_tickets");
    expect(list?.description).toMatch(/blocked: false.*claim/);
    expect(list?.inputSchema.properties).toHaveProperty("blocked");
  });
});

async function call(as: Fetch, path: string, body: object) {
  const res = await as(path, { method: "POST", body: JSON.stringify(body) });
  if (res.status >= 400) throw new Error(`POST ${path} failed: ${await res.text()}`);
}
