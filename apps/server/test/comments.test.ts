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

type TimelineItem =
  | { type: "comment"; id: string; author: { type: string; id: string }; body: string }
  | { type: "activity"; kind: string; actor: { type: string; id: string } };

function comment(as: Fetch, key: string, body: string) {
  return as(`/api/tickets/${key}/comments`, { method: "POST", body: JSON.stringify({ body }) });
}

async function setup(t: TestApp) {
  const { owner } = await createCompany(t, { name: "Acme" });
  const agent = await createAgent(owner, "Claude-1");
  const { bearer } = await createApiKey(t, owner, agent.id);
  await createProject(owner.request, { name: "Board", key: "CB" });
  await createTicket(owner.request, { projectKey: "CB", title: "Work" });
  return { owner, agent, bearer };
}

describe("Comments", () => {
  it("adds Markdown Comments and reads them in order, credited to their author", async () => {
    const t = buildTestApp();
    const { owner, agent, bearer } = await setup(t);

    const first = await comment(bearer, "CB-1", "Tests pass:\n\n```\n12 passed\n```");
    await comment(owner.request, "CB-1", "Nice.");

    expect(first.status).toBe(201);
    const res = await owner.request("/api/tickets/CB-1/comments");
    const { comments } = (await res.json()) as {
      comments: { body: string; author: { type: string; id: string; name: string } }[];
    };
    expect(comments.map((c) => [c.author.type, c.author.name, c.body])).toEqual([
      ["agent", "Claude-1", "Tests pass:\n\n```\n12 passed\n```"],
      ["user", owner.user.name, "Nice."],
    ]);
    expect(comments[0]?.author.id).toBe(agent.id);
  });

  it("records each Comment as Activity", async () => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t);

    await comment(bearer, "CB-1", "Done.");

    const res = await owner.request("/api/tickets/CB-1/activity");
    const { activity } = (await res.json()) as { activity: object[] };
    expect(activity.at(-1)).toMatchObject({
      kind: "comment.added",
      actor: { type: "agent" },
      payload: { commentId: expect.any(String) },
    });
  });

  it("has no way to edit or delete a Comment", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    const res = await comment(owner.request, "CB-1", "Permanent.");
    const { comment: created } = (await res.json()) as { comment: { id: string } };

    const path = `/api/tickets/CB-1/comments/${created.id}`;
    const edit = await owner.request(path, {
      method: "PATCH",
      body: JSON.stringify({ body: "x" }),
    });
    const remove = await owner.request(path, { method: "DELETE" });

    expect([edit.status, remove.status]).toEqual([404, 404]);
  });

  it("refuses an empty Comment", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);

    const res = await comment(owner.request, "CB-1", "   ");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Write a comment." });
  });
});

describe("Ticket timeline", () => {
  it("merges Comments and Activity in time order, each credited to its Actor", async () => {
    const t = buildTestApp();
    const { owner, agent, bearer } = await setup(t);
    await bearer("/api/tickets/CB-1/claim", { method: "POST" });
    await comment(bearer, "CB-1", "On it.");
    await owner.request("/api/tickets/CB-1", {
      method: "PATCH",
      body: JSON.stringify({ priority: "high" }),
    });
    await comment(owner.request, "CB-1", "Bumped priority.");

    const res = await owner.request("/api/tickets/CB-1/timeline");

    const { timeline } = (await res.json()) as { timeline: TimelineItem[] };
    const summary = timeline.map((item) =>
      item.type === "comment"
        ? ["comment", item.author.type, item.body]
        : ["activity", item.actor.type, item.kind],
    );
    expect(summary).toEqual([
      ["activity", "user", "ticket.created"],
      ["activity", "agent", "ticket.claimed"],
      ["comment", "agent", "On it."],
      ["activity", "user", "ticket.updated"],
      ["comment", "user", "Bumped priority."],
    ]);
    const agentComment = timeline[2];
    expect(agentComment?.type === "comment" && agentComment.author.id).toBe(agent.id);
  });

  it("returns not-found for another Company's Ticket", async () => {
    const t = buildTestApp();
    await setup(t);
    const globex = await createCompany(t, { name: "Globex" });

    const read = await globex.owner.request("/api/tickets/CB-1/timeline");
    const write = await comment(globex.owner.request, "CB-1", "Hi.");

    expect([read.status, write.status]).toEqual([404, 404]);
  });
});
