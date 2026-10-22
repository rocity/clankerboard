import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
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
  const { key, secret, bearer } = await createApiKey(t, owner, agent.id);
  return { owner, agent, key, secret, bearer };
}

/** The 2025 handshake's first request, as any MCP client sends it. */
const initialize = {
  method: "POST",
  headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "curl", version: "0" },
    },
  }),
};

describe("MCP endpoint", () => {
  describe("authentication", () => {
    it("answers 401 without an API Key", async () => {
      const t = buildTestApp();

      const res = await t.request("/mcp", initialize);

      expect(res.status).toBe(401);
    });

    it("answers 401 for a made-up or revoked API Key", async () => {
      const t = buildTestApp();
      const { owner, agent, key, secret } = await setup(t);
      await owner.request(`/api/agents/${agent.id}/keys/${key.id}/revoke`, { method: "POST" });

      const madeUp = await t.bearer("cb_madeupmadeupmadeupmadeup")("/mcp", initialize);
      const revoked = await t.bearer(secret)("/mcp", initialize);

      expect(madeUp.status).toBe(401);
      expect(revoked.status).toBe(401);
    });

    it("does not accept a session cookie", async () => {
      const t = buildTestApp();
      const { owner } = await setup(t);

      const res = await owner.request("/mcp", initialize);

      expect(res.status).toBe(401);
    });

    it("spends from the same rate-limit bucket as the REST API and answers 429 with a retry hint", async () => {
      const t = buildTestApp({ config: { rateLimit: { capacity: 2, refillPerSecond: 0.01 } } });
      const { bearer } = await setup(t);

      const rest = await bearer("/api/projects");
      const first = await bearer("/mcp", initialize);
      const limited = await bearer("/mcp", initialize);

      expect(rest.status).toBe(200);
      expect(first.status).toBe(200);
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("100");
    });

    it("rejects a real MCP client with a bad key", async () => {
      const t = buildTestApp();

      await expect(t.mcpClient("cb_madeupmadeupmadeupmadeup")).rejects.toThrow();
    });
  });

  it.each([
    ["the 2025 handshake", false],
    ["the 2026-07-28 revision", true],
  ])("identifies as clankerboard with the app version over %s", async (_era, modern) => {
    const t = buildTestApp();
    const { secret } = await setup(t);

    const client = await t.mcpClient(secret, { modern });

    expect(client.getServerVersion()).toMatchObject({ name: "clankerboard", version: pkg.version });
  });

  it("declares an output schema for every tool, with timestamps as ISO strings", async () => {
    const t = buildTestApp();
    const { secret } = await setup(t);
    const client = await t.mcpClient(secret);

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["list_projects", "get_ticket"]),
    );
    for (const tool of tools) expect(tool.outputSchema).toMatchObject({ type: "object" });
    const getTicket = tools.find((tool) => tool.name === "get_ticket");
    expect(getTicket?.outputSchema).toMatchObject({
      properties: {
        ticket: { properties: { createdAt: { type: "string", format: "date-time" } } },
      },
    });
  });

  describe("list_projects", () => {
    it("returns the Company's Projects with Project Key, name, and Team, as Markdown and structured content", async () => {
      const t = buildTestApp();
      const { owner, secret } = await setup(t);
      const teamRes = await owner.request("/api/teams", {
        method: "POST",
        body: JSON.stringify({ name: "Platform" }),
      });
      const { team } = (await teamRes.json()) as { team: { id: string } };
      await createProject(owner.request, { name: "Board", key: "CB", teamId: team.id });
      await createProject(owner.request, { name: "Mobile", key: "MOB" });
      const other = await createCompany(t, { name: "Globex" });
      await createProject(other.owner.request, { name: "Secret", key: "SEC" });
      const client = await t.mcpClient(secret);

      const result = await client.callTool({ name: "list_projects", arguments: {} });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        projects: [
          { key: "CB", name: "Board", team: { id: team.id, name: "Platform" } },
          { key: "MOB", name: "Mobile", team: null },
        ],
      });
      const text = textOf(result);
      expect(text).toContain("CB");
      expect(text).toContain("Board");
      expect(text).toContain("Platform");
      expect(text).toContain("MOB");
      expect(text).not.toContain("SEC");
    });
  });

  describe("get_ticket", () => {
    it("returns the Ticket with its Parent, children, and Comments", async () => {
      const t = buildTestApp();
      const { owner, secret, bearer } = await setup(t);
      await createProject(owner.request, { name: "Board", key: "CB" });
      await createTicket(owner.request, { projectKey: "CB", title: "Auth revamp", type: "epic" });
      await createTicket(owner.request, {
        projectKey: "CB",
        title: "Fix login",
        type: "story",
        description: "Login **breaks** on Safari.",
        priority: "high",
        parentKey: "CB-1",
      });
      await createTicket(owner.request, {
        projectKey: "CB",
        title: "Reproduce",
        type: "task",
        parentKey: "CB-2",
      });
      await addComment(owner.request, "CB-2", "Seen on iOS too.");
      await addComment(bearer, "CB-2", "Tests pass locally.");
      const client = await t.mcpClient(secret);

      const result = await client.callTool({ name: "get_ticket", arguments: { key: "CB-2" } });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        ticket: {
          key: "CB-2",
          title: "Fix login",
          type: "story",
          status: "backlog",
          priority: "high",
          description: "Login **breaks** on Safari.",
          parent: { key: "CB-1", title: "Auth revamp", type: "epic" },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        children: [{ key: "CB-3", title: "Reproduce", type: "task", status: "backlog" }],
        comments: [
          { body: "Seen on iOS too.", author: { type: "user" } },
          { body: "Tests pass locally.", author: { type: "agent", name: "Claude-1" } },
        ],
      });
      const text = textOf(result);
      for (const expected of [
        "CB-2",
        "Fix login",
        "Login **breaks** on Safari.",
        "CB-1",
        "Auth revamp",
        "CB-3",
        "Reproduce",
        "Seen on iOS too.",
        "Tests pass locally.",
        "Claude-1",
      ]) {
        expect(text).toContain(expected);
      }
    });

    it("answers unknown and other-Company Ticket Keys with the same tool error", async () => {
      const t = buildTestApp();
      const { owner, secret } = await setup(t);
      await createProject(owner.request, { name: "Board", key: "CB" });
      const other = await createCompany(t, { name: "Globex" });
      await createProject(other.owner.request, { name: "Secret", key: "SEC" });
      await createTicket(other.owner.request, { projectKey: "SEC", title: "Hidden" });
      const client = await t.mcpClient(secret);

      const unknown = await client.callTool({ name: "get_ticket", arguments: { key: "CB-99" } });
      const foreign = await client.callTool({ name: "get_ticket", arguments: { key: "SEC-1" } });

      expect(unknown.isError).toBe(true);
      expect(textOf(unknown)).toBe("Not found.");
      expect(foreign.isError).toBe(true);
      expect(textOf(foreign)).toBe(textOf(unknown));
    });

    it("answers a malformed Ticket Key with a tool error", async () => {
      const t = buildTestApp();
      const { secret } = await setup(t);
      const client = await t.mcpClient(secret);

      const result = await client.callTool({ name: "get_ticket", arguments: { key: "nope" } });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("Use a ticket key like CB-42.");
    });
  });
});

async function addComment(as: Fetch, key: string, body: string) {
  const res = await as(`/api/tickets/${key}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  if (res.status !== 201) throw new Error(`addComment failed: ${await res.text()}`);
}

/** The Markdown a tool returned. */
function textOf(result: { content?: unknown }) {
  const content = result.content as { type: string; text?: string }[];
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
