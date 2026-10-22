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
  type SignedInUser,
  type TestApp,
} from "./harness";

type McpClient = Awaited<ReturnType<TestApp["mcpClient"]>>;

/** Acme with Project CB, and Agent Claude-1 connected over MCP. */
async function setup(t: TestApp) {
  const { owner } = await createCompany(t, { name: "Acme" });
  const agent = await createAgent(owner, "Claude-1");
  const { secret } = await createApiKey(t, owner, agent.id);
  await createProject(owner.request, { name: "Clankerboard", key: "CB" });
  const client = await t.mcpClient(secret);
  return { owner, agent, client };
}

describe("MCP tool list", () => {
  it("offers the v1 tools and no delete, archive, or restore tool", async () => {
    const t = buildTestApp();
    const { client } = await setup(t);

    const { tools } = await client.listTools();

    const names = tools.map((tool) => tool.name);
    expect([...names].sort()).toEqual([
      "add_comment",
      "assign_ticket",
      "claim_ticket",
      "create_ticket",
      "get_ticket",
      "link_tickets",
      "list_projects",
      "list_tickets",
      "move_ticket",
      "unlink_tickets",
      "update_ticket",
    ]);
    for (const name of names) expect(name).not.toMatch(/delete|archive|restore|remove/);
  });

  it("says in every description that tickets are addressed by ticket key", async () => {
    const t = buildTestApp();
    const { client } = await setup(t);

    const { tools } = await client.listTools();

    for (const tool of tools) expect(tool.description, tool.name).toMatch(/ticket key/i);
  });

  it("tells the agent to claim before starting work and to pick another ticket if the claim fails", async () => {
    const t = buildTestApp();
    const { client } = await setup(t);

    const { tools } = await client.listTools();

    const claim = tools.find((tool) => tool.name === "claim_ticket")?.description;
    expect(claim).toMatch(/before you start work/);
    expect(claim).toMatch(/claim fails.*pick another ticket/);
  });

  it("says list_tickets and assign_ticket take a user's email or an agent's name", async () => {
    const t = buildTestApp();
    const { client } = await setup(t);

    const { tools } = await client.listTools();

    for (const name of ["list_tickets", "assign_ticket"]) {
      const description = tools.find((tool) => tool.name === name)?.description;
      expect(description, name).toMatch(/user's email.*agent's name/);
    }
  });

  it("walks the agent through the loop: orient, claim, comment, move to review", async () => {
    const t = buildTestApp();
    const { client } = await setup(t);

    const { tools } = await client.listTools();

    const describe = (name: string) => tools.find((tool) => tool.name === name)?.description;
    // Each step names the tool for the next one.
    expect(describe("list_projects")).toContain("list_tickets");
    expect(describe("list_tickets")).toContain("claim_ticket");
    expect(describe("claim_ticket")).toContain("add_comment");
    expect(describe("add_comment")).toContain("move_ticket");
    expect(describe("move_ticket")).toMatch(/to review/);
  });
});

describe("agent loop smoke", () => {
  /**
   * CB-1 epic; To Do bugs CB-2 (low), CB-3 (high, under CB-1), and CB-4
   * (urgent, held by the owner); CB-5 an urgent bug still in Backlog; CB-6 an
   * urgent To Do task. The next bug to work on is CB-3.
   */
  async function seed(owner: SignedInUser) {
    const as = owner.request;
    await createTicket(as, { projectKey: "CB", title: "Auth revamp", type: "epic" });
    await createTicket(as, {
      projectKey: "CB",
      title: "Typo on login",
      type: "bug",
      priority: "low",
    });
    await createTicket(as, {
      projectKey: "CB",
      title: "Login breaks on Safari",
      type: "bug",
      priority: "high",
      parentKey: "CB-1",
    });
    await createTicket(as, {
      projectKey: "CB",
      title: "Crash on save",
      type: "bug",
      priority: "urgent",
    });
    await createTicket(as, {
      projectKey: "CB",
      title: "Flaky export",
      type: "bug",
      priority: "urgent",
    });
    await createTicket(as, { projectKey: "CB", title: "Write docs", priority: "urgent" });
    for (const key of ["CB-2", "CB-3", "CB-4", "CB-6"]) await move(as, key, "todo");
    await assignToUser(as, "CB-4", owner.user.id);
  }

  it("lists, claims the top bug, comments, and moves it to review, with the board following each step", async () => {
    const t = buildTestApp();
    const { owner, client } = await setup(t);
    const as = owner.request;
    await seed(owner);
    const seeded = (await activityOf(as, "CB-3")).length;
    const board = async () => {
      const result = await client.readResource({ uri: "clankerboard://projects/CB/board" });
      return (result.contents[0] as { text: string }).text;
    };

    // Orient: find the Project, then read its board.
    const projects = await client.callTool({ name: "list_projects", arguments: {} });
    expect(projects.structuredContent).toMatchObject({ projects: [{ key: "CB" }] });
    expect(section(await board(), "To Do")).toContain(
      "- **CB-3** [bug, high] Login breaks on Safari (unassigned)",
    );

    // The next bug: unassigned, ready, most urgent first.
    const listed = await client.callTool({
      name: "list_tickets",
      arguments: { projectKey: "CB", type: "bug", status: "todo", assignee: "unassigned" },
    });
    expect(listed.isError).toBeFalsy();
    const bugs = (listed.structuredContent as { tickets: { key: string }[] }).tickets;
    expect(bugs.map((ticket) => ticket.key)).toEqual(["CB-3", "CB-2"]);

    // Claim it before starting work.
    const top = bugs[0]?.key as string;
    const claimed = await client.callTool({ name: "claim_ticket", arguments: { key: top } });
    expect(claimed.isError).toBeFalsy();
    const afterClaim = await board();
    expect(section(afterClaim, "In Progress")).toContain(
      "- **CB-3** [bug, high] Login breaks on Safari (assignee: Claude-1 (agent))",
    );
    expect(section(afterClaim, "To Do")).not.toContain("CB-3");

    // Report the work.
    const commented = await client.callTool({
      name: "add_comment",
      arguments: { key: top, body: "Fixed on `fix/cb-3`. Tests: **42 passed**." },
    });
    expect(commented.isError).toBeFalsy();
    const read = await client.callTool({ name: "get_ticket", arguments: { key: top } });
    expect(read.structuredContent).toMatchObject({
      ticket: { status: "in_progress" },
      comments: [
        { body: "Fixed on `fix/cb-3`. Tests: **42 passed**.", author: { name: "Claude-1" } },
      ],
    });

    // Hand it over for review.
    const moved = await client.callTool({
      name: "move_ticket",
      arguments: { key: top, status: "review" },
    });
    expect(moved.isError).toBeFalsy();
    const afterMove = await board();
    expect(section(afterMove, "Review")).toBe(
      "- **CB-3** [bug, high] Login breaks on Safari (assignee: Claude-1 (agent))",
    );
    expect(section(afterMove, "In Progress")).toBe("No tickets.");
    expect(section(afterMove, "To Do")).toContain("**CB-2**");

    const byAgent = (await activityOf(as, "CB-3")).slice(seeded);
    expect(byAgent.length).toBeGreaterThan(0);
    for (const entry of byAgent) expect(entry.actor.name, entry.kind).toBe("Claude-1");
  });

  it("gives two agents running the loop at once a different bug each", async () => {
    const t = buildTestApp();
    const { owner, client } = await setup(t);
    await seed(owner);
    const second = await createAgent(owner, "Claude-2");
    const other = await t.mcpClient((await createApiKey(t, owner, second.id)).secret);

    /** List the unassigned To Do bugs and claim the first one that is still free. */
    async function claimNextBug(agent: McpClient) {
      const listed = await agent.callTool({
        name: "list_tickets",
        arguments: { projectKey: "CB", type: "bug", status: "todo", assignee: "unassigned" },
      });
      const { tickets } = listed.structuredContent as { tickets: { key: string }[] };
      for (const { key } of tickets) {
        const claim = await agent.callTool({ name: "claim_ticket", arguments: { key } });
        if (!claim.isError) return key;
      }
      return null;
    }

    const claimed = await Promise.all([claimNextBug(client), claimNextBug(other)]);

    expect([...claimed].sort()).toEqual(["CB-2", "CB-3"]);
    const result = await client.readResource({ uri: "clankerboard://projects/CB/board" });
    const inProgress = section((result.contents[0] as { text: string }).text, "In Progress");
    expect(inProgress).toContain("(assignee: Claude-1 (agent))");
    expect(inProgress).toContain("(assignee: Claude-2 (agent))");
  });
});

/** The body of one Status section of the board resource. */
function section(board: string, status: string) {
  const start = board.indexOf(`## ${status}\n\n`);
  if (start === -1) throw new Error(`no ${status} section`);
  const body = board.slice(start + `## ${status}\n\n`.length);
  const end = body.indexOf("\n\n## ");
  return end === -1 ? body : body.slice(0, end);
}

async function move(as: Fetch, key: string, status: string) {
  const res = await as(`/api/tickets/${key}/move`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
  if (res.status !== 200) throw new Error(`move failed: ${await res.text()}`);
}

async function assignToUser(as: Fetch, key: string, id: string) {
  const res = await as(`/api/tickets/${key}/assign`, {
    method: "POST",
    body: JSON.stringify({ assignee: { type: "user", id } }),
  });
  if (res.status !== 200) throw new Error(`assign failed: ${await res.text()}`);
}
