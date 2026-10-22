import { describe, expect, it } from "vitest";
import {
  activityOf,
  buildTestApp,
  createAgent,
  createApiKey,
  createCompany,
  createProject,
  createTicket,
  type SignedInUser,
  type TestApp,
} from "./harness";

async function setup(t: TestApp) {
  const { owner, members } = await createCompany(t, {
    name: "Acme",
    members: [{ email: "bob@example.com", role: "member" }],
  });
  const bob = members[0] as SignedInUser;
  const first = await createAgent(owner, "Claude-1");
  const second = await createAgent(owner, "Claude-2");
  const one = await createApiKey(t, owner, first.id);
  const two = await createApiKey(t, owner, second.id);
  await createProject(owner.request, { name: "Board", key: "CB" });
  await createTicket(owner.request, { projectKey: "CB", title: "Work" });
  return { owner, bob, first, second, one, two };
}

describe("MCP claim_ticket", () => {
  it("makes the Agent the Assignee, moves the Ticket to In Progress, and credits the Agent", async () => {
    const t = buildTestApp();
    const { owner, first, one } = await setup(t);
    const client = await t.mcpClient(one.secret);

    const result = await client.callTool({ name: "claim_ticket", arguments: { key: "CB-1" } });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      ticket: {
        key: "CB-1",
        status: "in_progress",
        assignee: { type: "agent", id: first.id, name: "Claude-1" },
      },
    });
    const text = textOf(result);
    expect(text).toContain("CB-1");
    expect(text).toContain("In Progress");
    expect(text).toContain("Claude-1 (agent)");
    const activity = await activityOf(owner.request, "CB-1");
    expect(activity.at(-1)).toMatchObject({
      kind: "ticket.claimed",
      actor: { type: "agent", id: first.id },
    });
  });

  it("fails with a tool error naming the holder when the Ticket is assigned", async () => {
    const t = buildTestApp();
    const { one, bob } = await setup(t);
    const client = await t.mcpClient(one.secret);
    await client.callTool({
      name: "assign_ticket",
      arguments: { key: "CB-1", assignee: "bob@example.com" },
    });

    const result = await client.callTool({ name: "claim_ticket", arguments: { key: "CB-1" } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`CB-1 is already held by ${bob.user.name}.`);
  });

  it("lets exactly one of two racing Agents win, and tells the other who holds it", async () => {
    const t = buildTestApp();
    const { owner, one, two } = await setup(t);
    const [clientOne, clientTwo] = await Promise.all([
      t.mcpClient(one.secret),
      t.mcpClient(two.secret),
    ]);

    const results = await Promise.all([
      clientOne.callTool({ name: "claim_ticket", arguments: { key: "CB-1" } }),
      clientTwo.callTool({ name: "claim_ticket", arguments: { key: "CB-1" } }),
    ]);

    const [won, lost] = results[0].isError ? [results[1], results[0]] : [results[0], results[1]];
    expect(won.isError).toBeFalsy();
    expect(lost.isError).toBe(true);
    const { ticket } = won.structuredContent as { ticket: { assignee: { name: string } } };
    expect(textOf(lost)).toBe(`CB-1 is already held by ${ticket.assignee.name}.`);
    const claims = (await activityOf(owner.request, "CB-1")).filter(
      (entry) => entry.kind === "ticket.claimed",
    );
    expect(claims).toHaveLength(1);
  });
});

describe("MCP assign_ticket", () => {
  it("assigns a user by email, an Agent by name, and unassigns with null", async () => {
    const t = buildTestApp();
    const { bob, second, one } = await setup(t);
    const client = await t.mcpClient(one.secret);
    const assign = (assignee: string | null) =>
      client.callTool({ name: "assign_ticket", arguments: { key: "CB-1", assignee } });

    const toUser = await assign("Bob@Example.com");
    expect(toUser.isError).toBeFalsy();
    expect(toUser.structuredContent).toMatchObject({
      ticket: { key: "CB-1", assignee: { type: "user", id: bob.user.id } },
    });
    expect(textOf(toUser)).toContain(`Assignee: ${bob.user.name}`);

    const toAgent = await assign("claude-2");
    expect(toAgent.isError).toBeFalsy();
    expect(toAgent.structuredContent).toMatchObject({
      ticket: { assignee: { type: "agent", id: second.id, name: "Claude-2" } },
    });
    expect(textOf(toAgent)).toContain("Assignee: Claude-2 (agent)");

    const cleared = await assign(null);
    expect(cleared.isError).toBeFalsy();
    expect(cleared.structuredContent).toMatchObject({ ticket: { assignee: null } });
    expect(textOf(cleared)).toContain("Assignee: unassigned");
  });

  it("assigns a user by the email another tool showed", async () => {
    const t = buildTestApp();
    const { owner, one } = await setup(t);
    const client = await t.mcpClient(one.secret);

    await owner.request("/api/tickets/CB-1/comments", {
      method: "POST",
      body: JSON.stringify({ body: "Over to you." }),
    });

    // The owner created CB-1 and commented, so get_ticket names them twice.
    const read = await client.callTool({ name: "get_ticket", arguments: { key: "CB-1" } });
    const { ticket, comments } = read.structuredContent as {
      ticket: { createdBy: { email: string } };
      comments: { author: { email: string } }[];
    };
    expect(ticket.createdBy.email).toBe(owner.user.email);
    expect(comments[0]?.author.email).toBe(owner.user.email);
    expect(textOf(read)).toContain(`Created by: ${owner.user.name} (${owner.user.email})`);
    expect(textOf(read)).toContain(`### ${owner.user.name} (${owner.user.email}), `);

    const result = await client.callTool({
      name: "assign_ticket",
      arguments: { key: "CB-1", assignee: ticket.createdBy.email },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      ticket: { assignee: { type: "user", id: owner.user.id, email: owner.user.email } },
    });
    expect(textOf(result)).toContain(`Assignee: ${owner.user.name} (${owner.user.email})`);
  });

  it("credits the assignment to the Agent", async () => {
    const t = buildTestApp();
    const { owner, first, one } = await setup(t);
    const client = await t.mcpClient(one.secret);

    await client.callTool({
      name: "assign_ticket",
      arguments: { key: "CB-1", assignee: "bob@example.com" },
    });

    const activity = await activityOf(owner.request, "CB-1");
    expect(activity.at(-1)).toMatchObject({
      kind: "ticket.assigned",
      actor: { type: "agent", id: first.id },
    });
  });

  it("refuses a revoked Agent with a tool error", async () => {
    const t = buildTestApp();
    const { owner, second, one } = await setup(t);
    await owner.request(`/api/agents/${second.id}/revoke`, { method: "POST" });
    const client = await t.mcpClient(one.secret);

    const result = await client.callTool({
      name: "assign_ticket",
      arguments: { key: "CB-1", assignee: "Claude-2" },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("That agent was revoked.");
  });

  it("refuses a non-member, another Company's Agent, and an unknown name with the same tool error", async () => {
    const t = buildTestApp();
    const { one } = await setup(t);
    const globex = await createCompany(t, { name: "Globex" });
    await createAgent(globex.owner, "Theirs");
    const client = await t.mcpClient(one.secret);
    const assign = (assignee: string) =>
      client.callTool({ name: "assign_ticket", arguments: { key: "CB-1", assignee } });

    const nonMember = await assign(globex.owner.user.email);
    const foreignAgent = await assign("Theirs");
    const unknown = await assign("nobody");

    for (const result of [nonMember, foreignAgent, unknown]) expect(result.isError).toBe(true);
    expect(textOf(nonMember)).toBe(`No user or agent matches "${globex.owner.user.email}".`);
    expect(textOf(foreignAgent)).toBe('No user or agent matches "Theirs".');
    expect(textOf(unknown)).toBe('No user or agent matches "nobody".');
  });

  it("answers an unknown Ticket Key with a not-found tool error", async () => {
    const t = buildTestApp();
    const { one } = await setup(t);
    const client = await t.mcpClient(one.secret);

    const result = await client.callTool({
      name: "assign_ticket",
      arguments: { key: "CB-99", assignee: null },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Not found.");
  });
});

/** The Markdown a tool returned. */
function textOf(result: { content?: unknown }) {
  const content = result.content as { type: string; text?: string }[];
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
