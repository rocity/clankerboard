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

/** Acme with Project CB, and Agent Claude-1 connected over MCP. */
async function setup(t: TestApp) {
  const { owner } = await createCompany(t, { name: "Acme" });
  const agent = await createAgent(owner, "Claude-1");
  const { secret, bearer } = await createApiKey(t, owner, agent.id);
  await createProject(owner.request, { name: "Board", key: "CB" });
  const client = await t.mcpClient(secret);
  return { owner, agent, bearer, client };
}

describe("MCP write tools", () => {
  it("lists the write tools as writes that destroy nothing", async () => {
    const t = buildTestApp();
    const { client } = await setup(t);

    const { tools } = await client.listTools();

    for (const name of ["create_ticket", "update_ticket", "move_ticket", "add_comment"]) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.annotations, name).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
      });
      expect(tool?.description, name).toMatch(/ticket key/);
    }
  });

  describe("create_ticket", () => {
    it("files a Ticket under a Parent, credited to the Agent", async () => {
      const t = buildTestApp();
      const { owner, agent, bearer, client } = await setup(t);
      await createTicket(owner.request, { projectKey: "CB", title: "Auth revamp", type: "epic" });

      const result = await client.callTool({
        name: "create_ticket",
        arguments: {
          projectKey: "CB",
          type: "bug",
          title: "Login breaks on Safari",
          description: "Steps: open **Safari**.",
          priority: "urgent",
          parentKey: "CB-1",
        },
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        ticket: { key: "CB-2", createdAt: "2026-01-01T00:00:00.000Z" },
      });
      expect(textOf(result)).toContain("CB-2");
      const res = await bearer("/api/tickets/CB-2");
      expect(((await res.json()) as { ticket: unknown }).ticket).toMatchObject({
        title: "Login breaks on Safari",
        type: "bug",
        status: "backlog",
        priority: "urgent",
        description: "Steps: open **Safari**.",
        parent: { key: "CB-1" },
        createdBy: { type: "agent", id: agent.id, name: "Claude-1" },
      });
      const activity = await activityOf(owner.request, "CB-2");
      expect(activity).toMatchObject([
        { kind: "ticket.created", actor: { type: "agent", id: agent.id } },
      ]);
    });
  });

  describe("update_ticket", () => {
    it("changes title, description, priority, and Parent, credited to the Agent", async () => {
      const t = buildTestApp();
      const { owner, agent, client } = await setup(t);
      await createTicket(owner.request, { projectKey: "CB", title: "Auth revamp", type: "epic" });
      await createTicket(owner.request, { projectKey: "CB", title: "Fix login", type: "story" });

      const result = await client.callTool({
        name: "update_ticket",
        arguments: {
          key: "CB-2",
          title: "Fix login on Safari",
          description: "Fails on **iOS** too.",
          priority: "high",
          parentKey: "CB-1",
        },
      });

      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toContain("Fix login on Safari");
      const read = await client.callTool({ name: "get_ticket", arguments: { key: "CB-2" } });
      expect(read.structuredContent).toMatchObject({
        ticket: {
          title: "Fix login on Safari",
          description: "Fails on **iOS** too.",
          priority: "high",
          parent: { key: "CB-1" },
          type: "story",
        },
      });
      const activity = await activityOf(owner.request, "CB-2");
      expect(activity.at(-1)).toMatchObject({
        kind: "ticket.updated",
        actor: { type: "agent", id: agent.id },
      });
    });

    it("clears the Parent with null and leaves other fields alone", async () => {
      const t = buildTestApp();
      const { owner, client } = await setup(t);
      await createTicket(owner.request, { projectKey: "CB", title: "Auth revamp", type: "epic" });
      await createTicket(owner.request, {
        projectKey: "CB",
        title: "Fix login",
        type: "story",
        priority: "urgent",
        parentKey: "CB-1",
      });

      const result = await client.callTool({
        name: "update_ticket",
        arguments: { key: "CB-2", parentKey: null },
      });

      expect(result.isError).toBeFalsy();
      const read = await client.callTool({ name: "get_ticket", arguments: { key: "CB-2" } });
      expect(read.structuredContent).toMatchObject({
        ticket: { title: "Fix login", priority: "urgent", parent: null },
      });
    });
  });

  describe("move_ticket", () => {
    it("changes Status and places the Ticket at the bottom of that Status, credited to the Agent", async () => {
      const t = buildTestApp();
      const { owner, agent, bearer, client } = await setup(t);
      for (const title of ["One", "Two", "Three"]) {
        await createTicket(owner.request, { projectKey: "CB", title });
      }
      await move(owner.request, "CB-2", { status: "review" });
      await move(owner.request, "CB-3", { status: "review" });

      const result = await client.callTool({
        name: "move_ticket",
        arguments: { key: "CB-1", status: "review" },
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ ticket: { key: "CB-1", status: "review" } });
      expect(textOf(result)).toContain("Review");
      expect(await keysIn(bearer, "review")).toEqual(["CB-2", "CB-3", "CB-1"]);
      const activity = await activityOf(owner.request, "CB-1");
      expect(activity.at(-1)).toMatchObject({
        kind: "ticket.moved",
        actor: { type: "agent", id: agent.id },
        payload: { from: { status: "backlog" }, to: { status: "review" } },
      });
    });

    it("moves a Ticket to the bottom of its own Status", async () => {
      const t = buildTestApp();
      const { owner, bearer, client } = await setup(t);
      for (const title of ["One", "Two", "Three"]) {
        await createTicket(owner.request, { projectKey: "CB", title });
      }

      const result = await client.callTool({
        name: "move_ticket",
        arguments: { key: "CB-1", status: "backlog" },
      });

      expect(result.isError).toBeFalsy();
      expect(await keysIn(bearer, "backlog")).toEqual(["CB-2", "CB-3", "CB-1"]);
    });
  });

  describe("add_comment", () => {
    it("confirms with the Ticket Key in capitals, however it was typed", async () => {
      const t = buildTestApp();
      const { owner, client } = await setup(t);
      await createTicket(owner.request, { projectKey: "CB", title: "Fix login" });

      const result = await client.callTool({
        name: "add_comment",
        arguments: { key: "cb-1", body: "Done." },
      });

      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toBe("Added a comment to **CB-1** as Claude-1 (agent).");
    });

    it("appends a Markdown Comment authored by the Agent", async () => {
      const t = buildTestApp();
      const { owner, agent, client } = await setup(t);
      await createTicket(owner.request, { projectKey: "CB", title: "Fix login" });
      const body = "## Summary\n\n- Fixed the cookie check\n- `pnpm test` passes";

      const result = await client.callTool({
        name: "add_comment",
        arguments: { key: "CB-1", body },
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        comment: {
          body,
          author: { type: "agent", name: "Claude-1" },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      });
      expect(textOf(result)).toContain("CB-1");
      const read = await client.callTool({ name: "get_ticket", arguments: { key: "CB-1" } });
      expect(read.structuredContent).toMatchObject({
        comments: [{ body, author: { type: "agent", id: agent.id } }],
      });
      // A Comment stands in for its comment.added Activity on the timeline.
      const res = await owner.request("/api/tickets/CB-1/timeline");
      const { timeline } = (await res.json()) as { timeline: unknown[] };
      expect(timeline.at(-1)).toMatchObject({
        type: "comment",
        author: { type: "agent", id: agent.id },
        activityId: expect.any(Number),
      });
    });
  });

  describe("rule violations", () => {
    /** CB-1 epic, CB-2 bug under it, CB-3 epic that is archived. */
    async function seedHierarchy(t: TestApp) {
      const fixture = await setup(t);
      const { owner } = fixture;
      await createTicket(owner.request, { projectKey: "CB", title: "Auth", type: "epic" });
      await createTicket(owner.request, {
        projectKey: "CB",
        title: "Crash",
        type: "bug",
        parentKey: "CB-1",
      });
      await createTicket(owner.request, { projectKey: "CB", title: "Old", type: "epic" });
      await owner.request("/api/tickets/CB-3/archive", { method: "POST" });
      return fixture;
    }

    it.each([
      [
        "an epic with a Parent",
        "create_ticket",
        { projectKey: "CB", type: "epic", title: "New", parentKey: "CB-1" },
        "An epic can't have a parent.",
      ],
      [
        "a task under a bug",
        "create_ticket",
        { projectKey: "CB", type: "task", title: "New", parentKey: "CB-2" },
        "A task can't sit under a bug.",
      ],
      [
        "an archived Parent on create",
        "create_ticket",
        { projectKey: "CB", type: "story", title: "New", parentKey: "CB-3" },
        "Restore CB-3 before adding tickets under it.",
      ],
      [
        "an archived Parent on update",
        "update_ticket",
        { key: "CB-2", parentKey: "CB-3" },
        "Restore CB-3 before adding tickets under it.",
      ],
      [
        "an epic under another Ticket on update",
        "update_ticket",
        { key: "CB-1", parentKey: "CB-2" },
        "An epic can't have a parent.",
      ],
      [
        "moving an archived Ticket",
        "move_ticket",
        { key: "CB-3", status: "todo" },
        "Archived tickets can't be moved.",
      ],
    ])("answers %s with a tool error and changes nothing", async (_case, name, args, message) => {
      const t = buildTestApp();
      const { bearer, client } = await seedHierarchy(t);
      const before = await ticketsOf(bearer);

      const result = await client.callTool({ name, arguments: args });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(message);
      expect(await ticketsOf(bearer)).toEqual(before);
    });

    it.each([
      ["create_ticket", { projectKey: "SEC", type: "task", title: "New" }],
      ["create_ticket", { projectKey: "CB", type: "task", title: "New", parentKey: "SEC-1" }],
      ["update_ticket", { key: "SEC-1", title: "Mine now" }],
      ["update_ticket", { key: "CB-2", parentKey: "SEC-1" }],
      ["move_ticket", { key: "SEC-1", status: "done" }],
      ["add_comment", { key: "SEC-1", body: "Hello" }],
      ["update_ticket", { key: "CB-99", title: "Ghost" }],
      ["move_ticket", { key: "CB-99", status: "done" }],
      ["add_comment", { key: "CB-99", body: "Hello" }],
    ])("answers %s on an unknown or other-Company key %j with Not found.", async (name, args) => {
      const t = buildTestApp();
      const { client } = await seedHierarchy(t);
      const other = await createCompany(t, { name: "Globex" });
      await createProject(other.owner.request, { name: "Secret", key: "SEC" });
      await createTicket(other.owner.request, { projectKey: "SEC", title: "Hidden", type: "epic" });

      const result = await client.callTool({ name, arguments: args });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("Not found.");
      const hidden = await other.owner.request("/api/tickets/SEC-1");
      expect(((await hidden.json()) as { ticket: unknown }).ticket).toMatchObject({
        title: "Hidden",
        status: "backlog",
      });
    });
  });
});

/** Every Ticket in CB, archived ones too, to show a failed call changed nothing. */
async function ticketsOf(as: Fetch) {
  const res = await as("/api/tickets?projectKey=CB&archived=include");
  return ((await res.json()) as { tickets: unknown[] }).tickets;
}

function move(as: Fetch, key: string, body: object) {
  return as(`/api/tickets/${key}/move`, { method: "POST", body: JSON.stringify(body) });
}

/** Ticket Keys in one Status of CB, top to bottom. */
async function keysIn(as: Fetch, status: string) {
  const res = await as(`/api/tickets?projectKey=CB&status=${status}`);
  return ((await res.json()) as { tickets: { key: string }[] }).tickets.map((row) => row.key);
}

/** The Markdown a tool returned. */
function textOf(result: { content?: unknown }) {
  const content = result.content as { type: string; text?: string }[];
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
