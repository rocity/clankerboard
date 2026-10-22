import { describe, expect, it } from "vitest";
import {
  activityOf,
  buildTestApp,
  createAgent,
  createApiKey,
  createCompany,
  createProject,
  createTicket,
  type OpenStream,
  openStream,
  type TestApp,
} from "./harness";

/** Acme with Project CB and Agent Claude-1. */
async function setup(t: TestApp) {
  const { owner } = await createCompany(t, { name: "Acme" });
  const agent = await createAgent(owner, "Claude-1");
  const { secret, bearer } = await createApiKey(t, owner, agent.id);
  await createProject(owner.request, { name: "Board", key: "CB" });
  return { owner, agent, secret, bearer };
}

describe("Live stream", () => {
  it("pushes a Ticket change made through REST as its Activity with a Ticket snapshot", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    const stream = await openStream(owner.request);

    await createTicket(owner.request, { projectKey: "CB", title: "Login breaks" });
    const event = await stream.nextEvent();
    await stream.close();

    const [created] = await activityOf(owner.request, "CB-1");
    expect(event.id).toBe(String(created?.id));
    expect(event.event).toBe("ticket.created");
    expect(JSON.parse(event.data)).toMatchObject({
      activity: {
        id: created?.id,
        kind: "ticket.created",
        ticketKey: "CB-1",
        actor: { type: "user", id: owner.user.id, name: owner.user.name },
        payload: { title: "Login breaks", status: "backlog" },
      },
      ticket: { key: "CB-1", title: "Login breaks", status: "backlog" },
    });
  });

  it("streams to an API Key a change an Agent makes through MCP, credited to the Agent", async () => {
    const t = buildTestApp();
    const { owner, agent, secret, bearer } = await setup(t);
    await createTicket(owner.request, { projectKey: "CB", title: "Login breaks" });
    await owner.request("/api/tickets/CB-1/move", {
      method: "POST",
      body: JSON.stringify({ status: "todo" }),
    });
    const stream = await openStream(bearer);
    const client = await t.mcpClient(secret);

    const claimed = await client.callTool({ name: "claim_ticket", arguments: { key: "CB-1" } });
    const event = await stream.nextEvent();
    await stream.close();

    expect(claimed.isError).toBeFalsy();
    const claim = (await activityOf(owner.request, "CB-1")).at(-1);
    expect([event.id, event.event]).toEqual([String(claim?.id), "ticket.claimed"]);
    expect(JSON.parse(event.data)).toMatchObject({
      activity: { actor: { type: "agent", id: agent.id, name: "Claude-1" } },
      ticket: {
        key: "CB-1",
        status: "in_progress",
        assignee: { type: "agent", id: agent.id, name: "Claude-1" },
      },
    });
  });

  it("refuses a caller with no session or API Key, or no active Company", async () => {
    const t = buildTestApp();
    const loner = await t.signUp({ email: "loner@example.com" });

    const anonymous = await t.request("/api/stream");
    const badKey = await t.bearer("cb_not_a_real_key")("/api/stream");
    const noCompany = await loner.request("/api/stream");

    expect([anonymous.status, badKey.status, noCompany.status]).toEqual([401, 401, 400]);
    expect(await noCompany.json()).toEqual({ error: "Pick a company first." });
  });

  it("gives every subscriber in the Company each event, and none to another Company", async () => {
    const t = buildTestApp();
    const { owner, bearer } = await setup(t);
    const globex = await createCompany(t, { name: "Globex" });
    await createProject(globex.owner.request, { name: "Globex board", key: "GX" });
    const ownerTab = await openStream(owner.request);
    const agentStream = await openStream(bearer);
    const globexTab = await openStream(globex.owner.request);

    await createTicket(globex.owner.request, { projectKey: "GX", title: "Theirs first" });
    await createTicket(owner.request, { projectKey: "CB", title: "Ours" });
    await createTicket(globex.owner.request, { projectKey: "GX", title: "Theirs second" });
    const titleOf = async (stream: OpenStream) =>
      JSON.parse((await stream.nextEvent()).data).ticket.title;
    const received = [
      await titleOf(ownerTab),
      await titleOf(agentStream),
      await titleOf(globexTab),
      await titleOf(globexTab),
    ];
    // A keepalive queues behind every event already published, so an Acme
    // stream reaching it next means no Globex event was coming.
    t.clock.advance(20_000);
    const afterwards = await Promise.all([ownerTab.next(), agentStream.next(), globexTab.next()]);
    await Promise.all([ownerTab.close(), agentStream.close(), globexTab.close()]);

    expect(received).toEqual(["Ours", "Ours", "Theirs first", "Theirs second"]);
    expect(afterwards).toEqual([
      { comment: "keepalive" },
      { comment: "keepalive" },
      { comment: "keepalive" },
    ]);
  });

  it("sends the Ticket Key in place of a snapshot when a Ticket is hard-deleted", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await createTicket(owner.request, { projectKey: "CB", title: "Login breaks" });
    const stream = await openStream(owner.request);

    const deleted = await owner.request("/api/tickets/CB-1", { method: "DELETE" });
    const event = await stream.nextEvent();
    await stream.close();

    expect(deleted.status).toBe(204);
    expect(event.event).toBe("ticket.deleted");
    expect(JSON.parse(event.data)).toMatchObject({
      activity: { kind: "ticket.deleted", ticketKey: "CB-1" },
      ticket: null,
    });
  });

  it("tells the client a retry interval and reverse proxies not to buffer", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);

    const stream = await openStream(owner.request);
    const first = await stream.next();
    await stream.close();

    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(stream.response.headers.get("x-accel-buffering")).toBe("no");
    expect(first).toEqual({ retry: 3000 });
  });

  it("ends open streams when the server shuts down", async () => {
    const shutdown = new AbortController();
    const t = buildTestApp({ deps: { shutdown: shutdown.signal } });
    const { owner, bearer } = await setup(t);
    const ownerTab = await openStream(owner.request);
    const agentStream = await openStream(bearer);
    await Promise.all([ownerTab.next(), agentStream.next()]);

    shutdown.abort();

    expect(await Promise.all([ownerTab.next(), agentStream.next()])).toEqual([null, null]);
  });

  it("sends a keepalive comment every 20 seconds on the clock", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    const stream = await openStream(owner.request);
    await stream.next();

    t.clock.advance(19_999);
    await createTicket(owner.request, { projectKey: "CB", title: "Login breaks" });
    const beforeDue = await stream.next();
    t.clock.advance(1);
    const firstKeepalive = await stream.next();
    t.clock.advance(20_000);
    const secondKeepalive = await stream.next();
    await stream.close();

    expect(beforeDue?.event).toBe("ticket.created");
    expect(firstKeepalive).toEqual({ comment: "keepalive" });
    expect(secondKeepalive).toEqual({ comment: "keepalive" });
  });
});
