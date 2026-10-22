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

async function setup(t: TestApp) {
  const { owner } = await createCompany(t, { name: "Acme" });
  const agent = await createAgent(owner, "Claude-1");
  const { secret, bearer } = await createApiKey(t, owner, agent.id);
  await createProject(owner.request, { name: "Clankerboard", key: "CB" });
  const client = await t.mcpClient(secret);
  return { owner, agent, secret, bearer, client };
}

type Listed = { tickets: { key: string }[]; nextCursor: string | null };

describe("list_tickets", () => {
  it("lists the most urgent first within each Status, then by rank", async () => {
    const t = buildTestApp();
    const { owner, client } = await setup(t);
    const as = owner.request;
    await createTicket(as, { projectKey: "CB", title: "Low", priority: "low" }); // CB-1
    await createTicket(as, { projectKey: "CB", title: "Urgent", priority: "urgent" }); // CB-2
    await createTicket(as, { projectKey: "CB", title: "Medium one", priority: "medium" }); // CB-3
    await createTicket(as, { projectKey: "CB", title: "Medium two", priority: "medium" }); // CB-4
    await createTicket(as, { projectKey: "CB", title: "Doing", priority: "urgent" }); // CB-5
    await move(as, "CB-5", "in_progress");
    // CB-4 ranks above CB-3 in Backlog.
    await as("/api/tickets/CB-4/move", { method: "POST", body: JSON.stringify({ position: 0 }) });

    const result = await client.callTool({ name: "list_tickets", arguments: {} });

    expect(result.isError).toBeFalsy();
    const listed = result.structuredContent as Listed;
    expect(listed.tickets.map((ticket) => ticket.key)).toEqual([
      "CB-2",
      "CB-4",
      "CB-3",
      "CB-1",
      "CB-5",
    ]);
    expect(listed.nextCursor).toBeNull();
    expect(textOf(result)).toContain("**CB-2** [task, Backlog, urgent] Urgent (unassigned)");
  });

  it("filters by Project, Status, type, priority, Assignee, Parent, and text", async () => {
    const t = buildTestApp();
    const { owner, agent, client } = await setup(t);
    const as = owner.request;
    await createProject(as, { name: "Other", key: "OT" });
    await createTicket(as, { projectKey: "CB", title: "Login epic", type: "epic" }); // CB-1
    await createTicket(as, {
      projectKey: "CB",
      title: "Crash on login",
      type: "bug",
      priority: "high",
      parentKey: "CB-1",
    }); // CB-2
    await createTicket(as, { projectKey: "CB", title: "Write docs", priority: "low" }); // CB-3
    await createTicket(as, { projectKey: "OT", title: "Elsewhere" }); // OT-1
    await move(as, "CB-3", "todo");
    await assign(as, "CB-2", { type: "agent", id: agent.id });
    await assign(as, "CB-3", { type: "user", id: owner.user.id });

    const keys = async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name: "list_tickets", arguments: args });
      expect(result.isError).toBeFalsy();
      return (result.structuredContent as Listed).tickets.map((ticket) => ticket.key);
    };

    expect(await keys({ projectKey: "OT" })).toEqual(["OT-1"]);
    expect(await keys({ projectKey: "CB", status: "todo" })).toEqual(["CB-3"]);
    expect(await keys({ type: "bug" })).toEqual(["CB-2"]);
    expect(await keys({ priority: "low" })).toEqual(["CB-3"]);
    expect(await keys({ projectKey: "CB", assignee: "unassigned" })).toEqual(["CB-1"]);
    expect(await keys({ assignee: "me" })).toEqual(["CB-2"]);
    expect(await keys({ assignee: `agent:${agent.id}` })).toEqual(["CB-2"]);
    expect(await keys({ assignee: "users" })).toEqual(["CB-3"]);
    expect(await keys({ parentKey: "CB-1" })).toEqual(["CB-2"]);
    expect(await keys({ q: "crash" })).toEqual(["CB-2"]);
  });

  it("names a User Assignee by email, and an Agent by name", async () => {
    const t = buildTestApp();
    const { owner, agent, client } = await setup(t);
    const as = owner.request;
    await createTicket(as, { projectKey: "CB", title: "Mine" }); // CB-1
    await createTicket(as, { projectKey: "CB", title: "Theirs" }); // CB-2
    await assign(as, "CB-1", { type: "user", id: owner.user.id });
    await assign(as, "CB-2", { type: "agent", id: agent.id });

    const result = await client.callTool({ name: "list_tickets", arguments: {} });

    expect(result.structuredContent).toMatchObject({
      tickets: [
        { key: "CB-1", assignee: { type: "user", email: owner.user.email } },
        { key: "CB-2", assignee: { type: "agent", name: "Claude-1", email: null } },
      ],
    });
    expect(textOf(result)).toContain(
      `**CB-1** [task, Backlog, medium] Mine (assignee: ${owner.user.name} (${owner.user.email}))`,
    );
  });

  it("filters by the user email or agent name another tool showed", async () => {
    const t = buildTestApp();
    const { owner, client } = await setup(t);
    const as = owner.request;
    const bob = await createAgent(owner, "Bob-bot");
    await createTicket(as, { projectKey: "CB", title: "Owner's" }); // CB-1
    await createTicket(as, { projectKey: "CB", title: "Bot's" }); // CB-2
    await createTicket(as, { projectKey: "CB", title: "Nobody's" }); // CB-3
    await assign(as, "CB-1", { type: "user", id: owner.user.id });
    await assign(as, "CB-2", { type: "agent", id: bob.id });

    const all = await client.callTool({ name: "list_tickets", arguments: {} });
    type Shown = { tickets: { key: string; assignee: { name: string; email: string | null } }[] };
    const shown = (all.structuredContent as Shown).tickets;
    const userHandle = shown.find((ticket) => ticket.key === "CB-1")?.assignee.email;
    const agentHandle = shown.find((ticket) => ticket.key === "CB-2")?.assignee.name;
    const keys = async (assignee: unknown) => {
      const result = await client.callTool({ name: "list_tickets", arguments: { assignee } });
      expect(result.isError, textOf(result)).toBeFalsy();
      return (result.structuredContent as Listed).tickets.map((ticket) => ticket.key);
    };

    expect(await keys(userHandle)).toEqual(["CB-1"]);
    expect(await keys(userHandle?.toUpperCase())).toEqual(["CB-1"]);
    expect(await keys(agentHandle)).toEqual(["CB-2"]);
    expect(await keys("bob-bot")).toEqual(["CB-2"]);

    const unknown = await client.callTool({
      name: "list_tickets",
      arguments: { assignee: "nobody" },
    });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toBe('No user or agent matches "nobody".');
  });

  it("returns 20 Tickets by default, and a cursor walks the rest in order", async () => {
    const t = buildTestApp();
    const { owner, client } = await setup(t);
    const priorities = ["low", "urgent", "medium", "high"];
    for (let i = 0; i < 22; i++) {
      await createTicket(owner.request, {
        projectKey: "CB",
        title: `Ticket ${i + 1}`,
        priority: priorities[i % 4],
      });
    }
    await move(owner.request, "CB-1", "todo");
    await move(owner.request, "CB-2", "todo");

    const first = await client.callTool({ name: "list_tickets", arguments: {} });
    const firstPage = first.structuredContent as Listed;
    expect(firstPage.tickets).toHaveLength(20);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(textOf(first)).toContain(`Next cursor: ${firstPage.nextCursor}`);

    const walked: string[] = [];
    let cursor: string | null = null;
    do {
      const result = await client.callTool({
        name: "list_tickets",
        arguments: { limit: 3, ...(cursor ? { cursor } : {}) },
      });
      const page = result.structuredContent as Listed;
      walked.push(...page.tickets.map((ticket) => ticket.key));
      cursor = page.nextCursor;
    } while (cursor);

    // Backlog: urgent (2 mod 4), high (0 mod 4), medium (3 mod 4), low (1 mod 4),
    // each in creation order, then To Do: CB-2 (urgent) before CB-1 (low).
    const backlog = (rest: number) =>
      Array.from({ length: 22 }, (_, i) => i + 1)
        .filter((n) => n > 2 && n % 4 === rest)
        .map((n) => `CB-${n}`);
    expect(walked).toEqual([
      ...backlog(2),
      ...backlog(0),
      ...backlog(3),
      ...backlog(1),
      "CB-2",
      "CB-1",
    ]);
  });

  it("refuses a cursor it did not hand out", async () => {
    const t = buildTestApp();
    const { client } = await setup(t);

    const result = await client.callTool({
      name: "list_tickets",
      arguments: { cursor: "not-a-cursor" },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("That page cursor is not valid.");
  });

  it("leaves out archived Tickets", async () => {
    const t = buildTestApp();
    const { owner, client } = await setup(t);
    await createTicket(owner.request, { projectKey: "CB", title: "Kept" }); // CB-1
    await createTicket(owner.request, { projectKey: "CB", title: "Shelved" }); // CB-2
    await owner.request("/api/tickets/CB-2/archive", { method: "POST" });

    const result = await client.callTool({ name: "list_tickets", arguments: {} });

    expect((result.structuredContent as Listed).tickets.map((ticket) => ticket.key)).toEqual([
      "CB-1",
    ]);
  });
});

describe("board resource", () => {
  const day = 24 * 60 * 60 * 1000;

  it("summarizes a Project's board by Status, most urgent first", async () => {
    const t = buildTestApp();
    const { owner, agent, client } = await setup(t);
    const as = owner.request;
    await createTicket(as, { projectKey: "CB", title: "Plan it", type: "epic" }); // CB-1
    await createTicket(as, {
      projectKey: "CB",
      title: "Fix crash",
      type: "bug",
      priority: "urgent",
    }); // CB-2
    await createTicket(as, { projectKey: "CB", title: "Write docs", priority: "low" }); // CB-3
    await createTicket(as, { projectKey: "CB", title: "Shelved" }); // CB-4
    await move(as, "CB-2", "in_progress");
    await assign(as, "CB-2", { type: "agent", id: agent.id });
    await assign(as, "CB-3", { type: "user", id: owner.user.id });
    await as("/api/tickets/CB-4/archive", { method: "POST" });

    const result = await client.readResource({ uri: "clankerboard://projects/CB/board" });

    const [content] = result.contents;
    expect(content).toMatchObject({
      uri: "clankerboard://projects/CB/board",
      mimeType: "text/markdown",
    });
    expect((content as { text: string }).text).toBe(
      [
        "# CB board: Clankerboard",
        "",
        "## Backlog",
        "",
        "- **CB-1** [epic, medium] Plan it (unassigned)",
        `- **CB-3** [task, low] Write docs (assignee: ${owner.user.name} (${owner.user.email}))`,
        "",
        "## To Do",
        "",
        "No tickets.",
        "",
        "## In Progress",
        "",
        "- **CB-2** [bug, urgent] Fix crash (assignee: Claude-1 (agent))",
        "",
        "## Review",
        "",
        "No tickets.",
        "",
        "## Done",
        "",
        "No tickets changed in the last 14 days.",
      ].join("\n"),
    );
  });

  it("leaves out Done Tickets last changed before the window", async () => {
    const t = buildTestApp({ config: { boardDoneWindowMs: 7 * day } });
    const { owner, client } = await setup(t);
    await createTicket(owner.request, { projectKey: "CB", title: "Old news" }); // CB-1
    await createTicket(owner.request, { projectKey: "CB", title: "Fresh" }); // CB-2
    await move(owner.request, "CB-1", "done");
    t.clock.advance(8 * day);
    await move(owner.request, "CB-2", "done");

    const result = await client.readResource({ uri: "clankerboard://projects/CB/board" });

    const text = (result.contents[0] as { text: string }).text;
    expect(text).toContain("- **CB-2** [task, medium] Fresh (unassigned)");
    expect(text).not.toContain("CB-1");
    expect(text).toContain("## Done\n\nChanged in the last 7 days.");
  });

  it("lists one board per Project", async () => {
    const t = buildTestApp();
    const { owner, client } = await setup(t);
    await createProject(owner.request, { name: "Other", key: "OT" });

    const { resources } = await client.listResources();

    expect(resources.map((r) => r.uri).sort()).toEqual([
      "clankerboard://projects/CB/board",
      "clankerboard://projects/OT/board",
    ]);
  });

  it("answers not found for an unknown or other Company's Project", async () => {
    const t = buildTestApp();
    const { client } = await setup(t);
    const { owner: stranger } = await createCompany(t, { name: "Elsewhere" });
    await createProject(stranger.request, { name: "Theirs", key: "TH" });

    const read = (key: string) =>
      client.readResource({ uri: `clankerboard://projects/${key}/board` });

    await expect(read("NOPE")).rejects.toThrow("Not found.");
    await expect(read("TH")).rejects.toThrow("Not found.");
    await expect(read("no-such")).rejects.toThrow("Not found.");
  });
});

async function move(as: Fetch, key: string, status: string) {
  const res = await as(`/api/tickets/${key}/move`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
  if (res.status !== 200) throw new Error(`move failed: ${await res.text()}`);
}

async function assign(as: Fetch, key: string, assignee: { type: string; id: string }) {
  const res = await as(`/api/tickets/${key}/assign`, {
    method: "POST",
    body: JSON.stringify({ assignee }),
  });
  if (res.status !== 200) throw new Error(`assign failed: ${await res.text()}`);
}

/** The Markdown a tool returned. */
function textOf(result: { content?: unknown }) {
  const content = result.content as { type: string; text?: string }[];
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
