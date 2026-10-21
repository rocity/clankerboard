import { describe, expect, it } from "vitest";
import { buildTestApp, createAgent, createApiKey, createCompany } from "./harness";

describe("API Key rate limit", () => {
  it("answers over-limit requests with 429 and Retry-After, then recovers as the bucket refills", async () => {
    const t = buildTestApp({ config: { rateLimit: { capacity: 2, refillPerSecond: 0.5 } } });
    const { owner } = await createCompany(t, { name: "Acme" });
    const agent = await createAgent(owner, "Looper");
    const { bearer } = await createApiKey(t, owner, agent.id);

    expect((await bearer("/api/whoami")).status).toBe(200);
    expect((await bearer("/api/whoami")).status).toBe(200);
    const limited = await bearer("/api/whoami");

    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("2");
    expect(await limited.json()).toEqual({ error: "Too many requests. Try again in 2 seconds." });

    t.clock.advance(1000);
    expect((await bearer("/api/whoami")).status).toBe(429);
    t.clock.advance(1000);
    expect((await bearer("/api/whoami")).status).toBe(200);
  });

  it("gives each key its own budget", async () => {
    const t = buildTestApp({ config: { rateLimit: { capacity: 1, refillPerSecond: 1 } } });
    const { owner } = await createCompany(t, { name: "Acme" });
    const agent = await createAgent(owner, "Looper");
    const first = await createApiKey(t, owner, agent.id, "one");
    const second = await createApiKey(t, owner, agent.id, "two");

    await first.bearer("/api/whoami");
    expect((await first.bearer("/api/whoami")).status).toBe(429);
    expect((await second.bearer("/api/whoami")).status).toBe(200);
  });

  it("turns a limited request away before it reaches the key lookup", async () => {
    const t = buildTestApp({ config: { rateLimit: { capacity: 1, refillPerSecond: 0.001 } } });
    const { owner } = await createCompany(t, { name: "Acme" });
    const agent = await createAgent(owner, "Looper");
    const { bearer } = await createApiKey(t, owner, agent.id);
    const start = t.clock.now().toISOString();
    expect((await bearer("/api/whoami")).status).toBe(200);

    t.clock.advance(61_000);
    expect((await bearer("/api/whoami")).status).toBe(429);

    // The lookup would have refreshed last-used, since a minute has passed.
    const res = await owner.request(`/api/agents/${agent.id}/keys`);
    expect(await res.json()).toMatchObject({ keys: [{ lastUsedAt: start }] });
  });

  it("does not limit session-authenticated humans", async () => {
    const t = buildTestApp({ config: { rateLimit: { capacity: 1, refillPerSecond: 1 } } });
    const { owner } = await createCompany(t, { name: "Acme" });

    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await owner.request("/api/whoami")).status);

    expect(statuses).toEqual([200, 200, 200, 200, 200]);
  });
});

describe("API Key last-used time", () => {
  it("updates at most once per minute per key", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });
    const agent = await createAgent(owner, "Claude-1");
    const { bearer } = await createApiKey(t, owner, agent.id);
    const lastUsed = async () => {
      const res = await owner.request(`/api/agents/${agent.id}/keys`);
      return ((await res.json()) as { keys: { lastUsedAt: string | null }[] }).keys[0]?.lastUsedAt;
    };
    const start = t.clock.now().getTime();

    expect(await lastUsed()).toBeNull();
    await bearer("/api/whoami");
    expect(await lastUsed()).toBe(new Date(start).toISOString());

    t.clock.advance(30_000);
    await bearer("/api/whoami");
    expect(await lastUsed()).toBe(new Date(start).toISOString());

    t.clock.advance(31_000);
    await bearer("/api/whoami");
    expect(await lastUsed()).toBe(new Date(start + 61_000).toISOString());

    const agents = await (await owner.request("/api/agents")).json();
    expect(agents).toMatchObject({
      agents: [{ lastActiveAt: new Date(start + 61_000).toISOString() }],
    });
  });
});
