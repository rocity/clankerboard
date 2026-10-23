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

describe("Labels over MCP", () => {
  it("describes labels on create_ticket and update_ticket, saying update replaces the set", async () => {
    const t = buildTestApp();
    const { client } = await connect(t);

    const { tools } = await client.listTools();
    const property = (name: string) => {
      const schema = tools.find((tool) => tool.name === name)?.inputSchema as
        | { properties: Record<string, { description?: string }> }
        | undefined;
      return schema?.properties.labels?.description;
    };

    expect(property("create_ticket")).toContain("A name no label has yet creates one.");
    expect(property("update_ticket")).toContain("Replaces the whole set of labels");
    expect(tools.find((tool) => tool.name === "list_labels")?.annotations).toMatchObject({
      readOnlyHint: true,
    });
  });

  it("applies Labels from create_ticket and replaces them from update_ticket, credited to the Agent", async () => {
    const t = buildTestApp();
    const { owner, agent, client } = await connect(t);
    await createTicket(owner.request, { projectKey: "CB", title: "Seed", labels: ["API"] });

    const created = await client.callTool({
      name: "create_ticket",
      arguments: { projectKey: "CB", type: "task", title: "Login", labels: ["api", "web"] },
    });
    const updated = await client.callTool({
      name: "update_ticket",
      arguments: { key: "CB-2", labels: ["API", "docs"] },
    });

    expect(created.structuredContent).toMatchObject({
      ticket: { key: "CB-2", labels: [{ name: "API" }, { name: "web" }] },
    });
    expect(updated.structuredContent).toMatchObject({
      ticket: { labels: [{ name: "API" }, { name: "docs" }] },
    });
    const last = (await activityOf(owner.request, "CB-2")).at(-1);
    expect(last).toMatchObject({
      kind: "ticket.updated",
      actor: { type: "agent", id: agent.id },
      payload: { changes: { labels: { from: ["API", "web"], to: ["API", "docs"] } } },
    });
  });

  it("refuses too many Labels with the plain message", async () => {
    const t = buildTestApp();
    const { client } = await connect(t);

    const result = await client.callTool({
      name: "create_ticket",
      arguments: {
        projectKey: "CB",
        type: "task",
        title: "Crowded",
        labels: Array.from({ length: 11 }, (_, i) => `l${i}`),
      },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("A ticket can have up to 10 labels.");
  });

  it("lists the Company's Labels with color and ticket count", async () => {
    const t = buildTestApp();
    const { owner, client } = await connect(t);
    await createTicket(owner.request, { projectKey: "CB", title: "A", labels: ["web", "api"] });
    await createTicket(owner.request, { projectKey: "CB", title: "B", labels: ["api"] });

    const result = await client.callTool({ name: "list_labels", arguments: {} });

    expect(result.structuredContent).toEqual({
      labels: [
        { name: "api", color: defaultLabelColor("api"), ticketCount: 2 },
        { name: "web", color: defaultLabelColor("web"), ticketCount: 1 },
      ],
    });
    expect(textOf(result)).toContain(`- **api** (${defaultLabelColor("api")}, 2 tickets)`);
    expect(textOf(result)).toContain(`- **web** (${defaultLabelColor("web")}, 1 ticket)`);
  });

  it("says so when the Company has no Labels", async () => {
    const t = buildTestApp();
    const { client } = await connect(t);

    const result = await client.callTool({ name: "list_labels", arguments: {} });

    expect(result.structuredContent).toEqual({ labels: [] });
    expect(textOf(result)).toContain("No labels yet.");
  });

  it("shows Label names in get_ticket, list_tickets, and the board, and filters list_tickets by one", async () => {
    const t = buildTestApp();
    const { owner, client } = await connect(t);
    const as = owner.request;
    await createTicket(as, {
      projectKey: "CB",
      title: "Plan it",
      type: "epic",
      labels: ["web", "api"],
    });
    await createTicket(as, { projectKey: "CB", title: "Plain", parentKey: "CB-1" });
    await createTicket(as, {
      projectKey: "CB",
      title: "Login",
      parentKey: "CB-1",
      labels: ["API"],
    });

    const got = await client.callTool({ name: "get_ticket", arguments: { key: "CB-1" } });
    const listed = await client.callTool({ name: "list_tickets", arguments: {} });
    const filtered = await client.callTool({ name: "list_tickets", arguments: { label: "Api" } });
    const board = await client.readResource({ uri: "agentkanban://projects/CB/board" });

    expect(got.structuredContent).toMatchObject({
      ticket: { labels: [{ name: "api" }, { name: "web" }] },
      children: [
        { key: "CB-2", labels: [] },
        { key: "CB-3", labels: ["api"] },
      ],
    });
    expect(textOf(got)).toContain("- Labels: api, web");
    expect(textOf(got)).toContain("**CB-2** [task, Backlog, medium] Plain (unassigned)\n");
    expect(textOf(got)).toContain(
      "**CB-3** [task, Backlog, medium] Login (unassigned) labels: api",
    );
    expect(listed.structuredContent).toMatchObject({
      tickets: [
        { key: "CB-1", labels: ["api", "web"] },
        { key: "CB-2", labels: [] },
        { key: "CB-3", labels: ["api"] },
      ],
    });
    expect(textOf(listed)).toContain(
      "**CB-1** [epic, Backlog, medium] Plan it (unassigned) labels: api, web",
    );
    expect(
      (filtered.structuredContent as { tickets: { key: string }[] }).tickets.map((t) => t.key),
    ).toEqual(["CB-1", "CB-3"]);
    const boardText = (board.contents[0] as { text: string }).text;
    expect(boardText).toContain("- **CB-1** [epic, medium] Plan it (unassigned) labels: api, web");
  });

  it("says a Ticket without Labels has none in get_ticket", async () => {
    const t = buildTestApp();
    const { owner, client } = await connect(t);
    await createTicket(owner.request, { projectKey: "CB", title: "Plain" });

    const got = await client.callTool({ name: "get_ticket", arguments: { key: "CB-1" } });

    expect(textOf(got)).toContain("- Labels: none");
  });
});
