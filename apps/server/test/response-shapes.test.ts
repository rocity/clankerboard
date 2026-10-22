import {
  commentView,
  projectView,
  ticketLinkView,
  ticketPage,
  ticketView,
  timelineItem,
} from "@clankerboard/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildTestApp,
  createAgent,
  createApiKey,
  createCompany,
  createProject,
  createTicket,
} from "./harness";

describe("Board response shapes", () => {
  it("match the shared schemas that MCP tools reuse", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });
    const agent = await createAgent(owner, "Claude-1");
    const { bearer } = await createApiKey(t, owner, agent.id);
    await createProject(owner.request, { name: "Board", key: "CB" });
    await createTicket(owner.request, { projectKey: "CB", title: "Epic", type: "epic" });
    await createTicket(bearer, {
      projectKey: "CB",
      title: "Story",
      type: "story",
      parentKey: "CB-1",
    });
    await bearer("/api/tickets/CB-2/claim", { method: "POST" });
    await bearer("/api/tickets/CB-2/comments", {
      method: "POST",
      body: JSON.stringify({ body: "On it." }),
    });
    const json = async (path: string) =>
      (await (await owner.request(path)).json()) as Record<string, unknown>;

    // Each parse throws, failing the test, if a response drifts from its schema.
    const project = projectView.parse((await json("/api/projects/CB")).project);
    const ticket = ticketView.parse((await json("/api/tickets/CB-2")).ticket);
    const page = ticketPage.parse(await json("/api/tickets?projectKey=CB"));
    const comments = z
      .array(commentView)
      .parse((await json("/api/tickets/CB-2/comments")).comments);
    expect(project.key).toBe("CB");
    expect(ticket.createdAt).toBeInstanceOf(Date);
    expect(page.tickets).toHaveLength(2);
    expect(comments[0]?.author.type).toBe("agent");
    const timeline = z
      .array(timelineItem)
      .parse((await json("/api/tickets/CB-2/timeline")).timeline);
    expect(timeline.map((item) => item.type)).toEqual(["activity", "activity", "comment"]);
    const created = await owner.request("/api/tickets/CB-2/links", {
      method: "POST",
      body: JSON.stringify({ kind: "blocked_by", target: "CB-1" }),
    });
    const link = ticketLinkView.parse(((await created.json()) as { link: unknown }).link);
    const links = z.array(ticketLinkView).parse((await json("/api/tickets/CB-1/links")).links);
    expect(link.createdAt).toBeInstanceOf(Date);
    expect(links.map((l) => l.kind)).toEqual(["blocks"]);
  });

  it("export to JSON Schema with timestamps as strings", () => {
    const schema = z.toJSONSchema(ticketView, { io: "input" }) as {
      properties: Record<string, { type?: string; format?: string }>;
    };

    expect(schema.properties.createdAt).toMatchObject({ type: "string", format: "date-time" });
  });
});
