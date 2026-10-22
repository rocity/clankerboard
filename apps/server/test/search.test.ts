import { describe, expect, it } from "vitest";
import {
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

async function list(as: Fetch, query: string) {
  const res = await as(`/api/tickets?${query}`);
  if (res.status !== 200) throw new Error(`${res.status}: ${await res.text()}`);
  return (await res.json()) as { tickets: { key: string }[]; nextCursor: string | null };
}

const keys = async (as: Fetch, query: string) =>
  (await list(as, query)).tickets.map((t) => t.key).sort();

const post = (as: Fetch, path: string, body?: object) =>
  as(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });

/**
 * CB (Team Platform):
 *   CB-1 epic   "Login revamp"         high,   todo
 *   CB-2 story  "Session cookies"      medium, under CB-1, assigned to Bob
 *   CB-3 bug    "Crash on save"        urgent, "The editor crashes when saving", Agent
 *   CB-4 task   "Write docs"           low,    archived
 * MOB:
 *   MOB-1 bug   "Login button misaligned" medium
 */
async function setup(t: TestApp) {
  const { owner, members } = await createCompany(t, {
    name: "Acme",
    members: [{ email: "bob@example.com", role: "member" }],
  });
  const bob = members[0] as SignedInUser;
  const agent = await createAgent(owner, "Claude-1");
  const { bearer } = await createApiKey(t, owner, agent.id);
  const teamRes = await owner.request("/api/teams", {
    method: "POST",
    body: JSON.stringify({ name: "Platform" }),
  });
  const { team } = (await teamRes.json()) as { team: { id: string } };
  await createProject(owner.request, { name: "Board", key: "CB", teamId: team.id });
  await createProject(owner.request, { name: "Mobile", key: "MOB" });

  const make = (input: Record<string, unknown>) =>
    createTicket(owner.request, { projectKey: "CB", ...input } as never);
  await make({ title: "Login revamp", type: "epic", priority: "high" });
  await make({ title: "Session cookies", type: "story", parentKey: "CB-1" });
  await make({
    title: "Crash on save",
    type: "bug",
    priority: "urgent",
    description: "The editor crashes when saving large files.",
  });
  await make({ title: "Write docs", type: "task", priority: "low" });
  await createTicket(owner.request, {
    projectKey: "MOB",
    title: "Login button misaligned",
    type: "bug",
  });

  await post(owner.request, "/api/tickets/CB-1/move", { status: "todo" });
  await post(owner.request, "/api/tickets/CB-2/assign", {
    assignee: { type: "user", id: bob.user.id },
  });
  await post(owner.request, "/api/tickets/CB-3/assign", {
    assignee: { type: "agent", id: agent.id },
  });
  await post(owner.request, "/api/tickets/CB-4/archive");
  return { owner, bob, agent, bearer, teamId: team.id };
}

describe("Listing Tickets", () => {
  it("filters by each field alone", async () => {
    const t = buildTestApp();
    const { owner, bob, agent, bearer, teamId } = await setup(t);

    expect(await keys(bearer, "projectKey=MOB")).toEqual(["MOB-1"]);
    expect(await keys(owner.request, "status=todo")).toEqual(["CB-1"]);
    expect(await keys(owner.request, "type=bug")).toEqual(["CB-3", "MOB-1"]);
    expect(await keys(owner.request, "priority=urgent")).toEqual(["CB-3"]);
    expect(await keys(owner.request, "parentKey=CB-1")).toEqual(["CB-2"]);
    expect(await keys(owner.request, `teamId=${teamId}`)).toEqual(["CB-1", "CB-2", "CB-3"]);
    expect(await keys(owner.request, "assignee=unassigned")).toEqual(["CB-1", "MOB-1"]);
    expect(await keys(owner.request, "assignee=agents")).toEqual(["CB-3"]);
    expect(await keys(owner.request, "assignee=users")).toEqual(["CB-2"]);
    expect(await keys(owner.request, `assignee=user:${bob.user.id}`)).toEqual(["CB-2"]);
    expect(await keys(owner.request, `assignee=agent:${agent.id}`)).toEqual(["CB-3"]);
  });

  it("combines filters", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);

    expect(await keys(owner.request, "type=bug&projectKey=CB")).toEqual(["CB-3"]);
    expect(await keys(owner.request, "type=bug&assignee=unassigned")).toEqual(["MOB-1"]);
    expect(await keys(owner.request, "projectKey=CB&status=backlog&priority=medium")).toEqual([
      "CB-2",
    ]);
  });

  it("finds Tickets by words in the description", async () => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t);

    expect(await keys(bearer, "q=editor")).toEqual(["CB-3"]);
    expect(await keys(owner.request, "q=crashing")).toEqual(["CB-3"]);
  });

  it("combines search with filters", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);

    expect(await keys(owner.request, "q=login")).toEqual(["CB-1", "MOB-1"]);
    expect(await keys(owner.request, "q=login&projectKey=MOB")).toEqual(["MOB-1"]);
    expect(await keys(owner.request, "q=login&type=epic")).toEqual(["CB-1"]);
  });

  it("leaves archived Tickets out unless asked", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);

    expect(await keys(owner.request, "projectKey=CB")).not.toContain("CB-4");
    expect(await keys(owner.request, "projectKey=CB&archived=include")).toContain("CB-4");
  });

  it("pages with a stable cursor and no overlap", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    for (let i = 0; i < 4; i++)
      await createTicket(owner.request, { projectKey: "MOB", title: `M${i}` });
    const all = (await list(owner.request, "limit=100")).tickets.map((x) => x.key);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await list(owner.request, `limit=3${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...page.tickets.map((x) => x.key));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    expect(all).toHaveLength(8);
    expect(pages).toBe(3);
    expect(seen).toEqual(all);
  });

  it("rejects a broken cursor or filter plainly", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);

    const cursor = await owner.request("/api/tickets?cursor=nonsense");
    const assignee = await owner.request("/api/tickets?assignee=everyone");

    expect(cursor.status).toBe(400);
    expect(await cursor.json()).toEqual({ error: "That page cursor is not valid." });
    expect(assignee.status).toBe(400);
  });

  it("only ever lists the caller's Company", async () => {
    const t = buildTestApp();
    await setup(t);
    const globex = await createCompany(t, { name: "Globex" });

    expect(await keys(globex.owner.request, "q=login")).toEqual([]);
    expect(await keys(globex.owner.request, "projectKey=CB")).toEqual([]);
  });
});
