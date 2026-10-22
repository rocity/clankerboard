import { schema } from "@agentkanban/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createAgent,
  createApiKey,
  createCompany,
  createProject,
  createTicket,
  nextTicketTitle,
  type OpenStream,
  openStream,
  testDatabase,
} from "./harness";

/**
 * Moves the User's sessions' expiry to `at`. Better Auth stamps expiry on the
 * real clock, days ahead of the fake one, so no API call can bring it near.
 */
async function expireSessionsOf(userId: string, at: Date) {
  await testDatabase()
    .db.update(schema.sessions)
    .set({ expiresAt: at })
    .where(eq(schema.sessions.userId, userId));
}

/** Reads past the opening `retry:` line, so the stream is known to be open. */
async function opened(stream: Promise<OpenStream>) {
  const open = await stream;
  await open.next();
  return open;
}

describe("Live stream revocation", () => {
  it("closes a removed User's stream for the Company", async () => {
    const t = buildTestApp();
    const { owner, members } = await createCompany(t, {
      name: "Acme",
      members: [{ email: "mia@example.com", role: "member" }],
    });
    const [mia] = members;
    if (!mia) throw new Error("no member");
    await createProject(owner.request, { name: "Board", key: "CB" });
    const miaTab = await opened(openStream(mia.request));

    const removed = await owner.request(`/api/members/${mia.user.id}`, { method: "DELETE" });

    expect(removed.status).toBe(204);
    expect(await miaTab.next()).toBeNull();
  });

  it("closes a revoked Agent's stream", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });
    const agent = await createAgent(owner, "Claude-1");
    const { bearer } = await createApiKey(t, owner, agent.id);
    const agentStream = await opened(openStream(bearer));

    const revoked = await owner.request(`/api/agents/${agent.id}/revoke`, { method: "POST" });

    expect(revoked.status).toBe(200);
    expect(await agentStream.next()).toBeNull();
  });

  it("closes an Agent's stream when its key is revoked", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });
    const agent = await createAgent(owner, "Claude-1");
    const { key, bearer } = await createApiKey(t, owner, agent.id);
    const agentStream = await opened(openStream(bearer));

    const revoked = await owner.request(`/api/agents/${agent.id}/keys/${key.id}/revoke`, {
      method: "POST",
    });

    expect(revoked.status).toBe(200);
    expect(await agentStream.next()).toBeNull();
  });

  it("closes a stream with an auth error event on the first keepalive after its session expires", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });
    const tab = await opened(openStream(owner.request));
    await expireSessionsOf(owner.user.id, new Date(t.clock.now().getTime() + 30_000));

    t.clock.advance(20_000);
    const whileLive = await tab.next();
    t.clock.advance(20_000);
    const afterExpiry = await tab.next();
    const end = await tab.next();

    expect(whileLive).toEqual({ comment: "keepalive" });
    expect(afterExpiry).toEqual({
      event: "unauthorized",
      data: JSON.stringify({ error: "Your session expired. Sign in again." }),
    });
    expect(end).toBeNull();
  });

  it("keeps every other stream receiving events, even the removed User's in another Company", async () => {
    const t = buildTestApp();
    const { owner, members } = await createCompany(t, {
      name: "Acme",
      members: [{ email: "mia@example.com", role: "member" }],
    });
    const [mia] = members;
    if (!mia) throw new Error("no member");
    await createProject(owner.request, { name: "Board", key: "CB" });
    const ownersAgent = await createAgent(owner, "Claude-1");
    const miasAgent = await createAgent(mia, "Claude-2");
    const ownersKey = await createApiKey(t, owner, ownersAgent.id);
    const miasKey = await createApiKey(t, mia, miasAgent.id);
    // A second session of Mia's, working in a Company of her own.
    const miaElsewhere = await t.signIn({ email: "mia@example.com" });
    await createCompany(t, { name: "Globex", owner: miaElsewhere });
    await createProject(miaElsewhere.request, { name: "Globex board", key: "GX" });
    const [ownerTab, ownersAgentStream, miaTab, miasAgentStream, miaGlobexTab] = await Promise.all([
      opened(openStream(owner.request)),
      opened(openStream(ownersKey.bearer)),
      opened(openStream(mia.request)),
      opened(openStream(miasKey.bearer)),
      opened(openStream(miaElsewhere.request)),
    ]);

    await owner.request(`/api/members/${mia.user.id}`, { method: "DELETE" });
    const ended = await Promise.all([miaTab.next(), miasAgentStream.next()]);
    await createTicket(owner.request, { projectKey: "CB", title: "Ours" });
    await createTicket(miaElsewhere.request, { projectKey: "GX", title: "Hers" });
    const received = await Promise.all(
      [ownerTab, ownersAgentStream, miaGlobexTab].map(nextTicketTitle),
    );
    await Promise.all([ownerTab.close(), ownersAgentStream.close(), miaGlobexTab.close()]);

    expect(ended).toEqual([null, null]);
    expect(received).toEqual(["Ours", "Ours", "Hers"]);
  });
});
