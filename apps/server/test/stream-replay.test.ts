import { type ActivityEvent, InProcessEventBus } from "@clankerboard/domain";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createCompany,
  createProject,
  createTicket,
  type OpenStream,
  openStream,
  type StreamMessage,
  type TestApp,
  testDatabase,
} from "./harness";

/** Acme with Project CB. */
async function setup(t: TestApp) {
  const { owner } = await createCompany(t, { name: "Acme" });
  await createProject(owner.request, { name: "Board", key: "CB" });
  return { owner };
}

/**
 * Holds a Project row the way a concurrent writer would, until released. A
 * Comment on one of its Tickets then stalls after its Activity id is
 * allocated, because the Activity's foreign-key check waits on the row.
 */
async function lockProjectRow(key: string) {
  let release = () => {};
  let locked = () => {};
  const isLocked = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const held = testDatabase().db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from projects where key = ${key} for update`);
    locked();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  await isLocked;
  return async () => {
    release();
    await held;
  };
}

/** Waits until `count` queries in this test database are waiting on a lock. */
async function lockWaiters(count: number) {
  for (;;) {
    const { rows } = await testDatabase().db.execute<{ waiting: number }>(
      sql`select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if ((rows[0]?.waiting ?? 0) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const settled = (promise: Promise<unknown>) =>
  promise.then(
    () => true,
    () => true,
  );

const resumingFrom = (id: string) => ({ headers: { "last-event-id": id } });

type Received = { id: string; event?: string; key?: string | null };

function received(message: StreamMessage & { id: string }): Received {
  const data = message.data ? JSON.parse(message.data) : {};
  return { id: message.id, event: message.event, key: data.activity?.ticketKey };
}

/** Every event up to the next keepalive, which queues behind anything already published. */
async function eventsUntilKeepalive(t: TestApp, stream: OpenStream) {
  t.clock.advance(20_000);
  const events: Received[] = [];
  for (;;) {
    const message = await stream.next();
    if (!message || message.comment === "keepalive") return events;
    if (message.id !== undefined) events.push(received({ ...message, id: message.id }));
  }
}

/**
 * Holds published Activity back until released, as a change that has
 * committed but whose publish has not yet reached the stream.
 */
class HeldEventBus extends InProcessEventBus {
  private held: ActivityEvent[] | null = null;

  hold() {
    this.held = [];
  }
  release() {
    const held = this.held ?? [];
    this.held = null;
    for (const event of held) super.publish(event);
  }
  override publish(event: ActivityEvent) {
    if (this.held) this.held.push(event);
    else super.publish(event);
  }
}

describe("Live stream catch-up", () => {
  it("replays the Company's Activity after Last-Event-ID, in order, on reconnect", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    // A second tab that never disconnects sees everything the first one missed.
    const witness = await openStream(owner.request);
    const tab = await openStream(owner.request);
    await createTicket(owner.request, { projectKey: "CB", title: "Login breaks" });
    const lastSeen = await tab.nextEvent();
    await tab.close();

    await owner.request("/api/tickets/CB-1/move", {
      method: "POST",
      body: JSON.stringify({ status: "todo" }),
    });
    await createTicket(owner.request, { projectKey: "CB", title: "Signup breaks" });
    await owner.request("/api/tickets/CB-1/comments", {
      method: "POST",
      body: JSON.stringify({ body: "On it" }),
    });
    const reconnected = await openStream(owner.request, resumingFrom(lastSeen.id));
    const replayed = await eventsUntilKeepalive(t, reconnected);
    const live = await eventsUntilKeepalive(t, witness);
    await Promise.all([reconnected.close(), witness.close()]);

    expect(replayed.map((e) => e.event)).toEqual([
      "ticket.moved",
      "ticket.created",
      "comment.added",
    ]);
    expect(replayed).toEqual(live.slice(1));
  });

  it("sends a change made during the reconnect once, in the backlog or live", async () => {
    const events = new HeldEventBus();
    const t = buildTestApp({ deps: { events } });
    const { owner } = await setup(t);
    const tab = await openStream(owner.request);
    await createTicket(owner.request, { projectKey: "CB", title: "Seen" });
    const lastSeen = await tab.nextEvent();
    await tab.close();

    // Committed before the reconnect, published after it subscribed: the
    // backlog and the live feed both have it.
    events.hold();
    await createTicket(owner.request, { projectKey: "CB", title: "Committed, not yet published" });
    const reconnected = await openStream(owner.request, resumingFrom(lastSeen.id));
    const fromBacklog = received(await reconnected.nextEvent());
    events.release();
    // Committed after the backlog was read: only the live feed has it.
    await createTicket(owner.request, { projectKey: "CB", title: "During the replay" });
    const rest = await eventsUntilKeepalive(t, reconnected);
    await reconnected.close();

    expect([fromBacklog, ...rest].map((e) => e.key)).toEqual(["CB-2", "CB-3"]);
  });

  it("sends one resync event instead of a backlog over the configured limit, then carries on live", async () => {
    const t = buildTestApp({ config: { streamBacklogLimit: 2 } });
    const { owner } = await setup(t);
    const tab = await openStream(owner.request);
    await createTicket(owner.request, { projectKey: "CB", title: "Seen" });
    const lastSeen = await tab.nextEvent();
    await tab.close();

    for (const title of ["One", "Two", "Three"]) {
      await createTicket(owner.request, { projectKey: "CB", title });
    }
    const witness = await openStream(owner.request);
    const reconnected = await openStream(owner.request, resumingFrom(lastSeen.id));
    const resync = await reconnected.nextEvent();
    await createTicket(owner.request, { projectKey: "CB", title: "After the resync" });
    const rest = await eventsUntilKeepalive(t, reconnected);
    const [afterwards] = await eventsUntilKeepalive(t, witness);
    await Promise.all([reconnected.close(), witness.close()]);

    expect(resync.event).toBe("resync");
    expect(rest).toEqual([afterwards]);
    expect(afterwards?.key).toBe("CB-5");
  });

  it("sees each change exactly once when one commits after a later-numbered one started", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await createProject(owner.request, { name: "Ops", key: "OPS" });
    await createTicket(owner.request, { projectKey: "CB", title: "Login breaks" });
    const tab = await openStream(owner.request);
    await createTicket(owner.request, { projectKey: "CB", title: "Seen" });
    const seen = [received(await tab.nextEvent())];

    const unlock = await lockProjectRow("CB");
    const slow = owner.request("/api/tickets/CB-1/comments", {
      method: "POST",
      body: JSON.stringify({ body: "Stalled after its Activity id" }),
    });
    await lockWaiters(1);
    const fast = createTicket(owner.request, { projectKey: "OPS", title: "Numbered after it" });
    // The later change either commits first or waits its turn.
    await Promise.race([settled(fast), lockWaiters(2)]);
    seen.push(...(await eventsUntilKeepalive(t, tab)));
    await tab.close();
    await unlock();
    await Promise.all([slow, fast]);
    const reconnected = await openStream(owner.request, resumingFrom(seen.at(-1)?.id ?? ""));
    const replayed = await eventsUntilKeepalive(t, reconnected);
    await reconnected.close();

    const all = [...seen, ...replayed].map((e) => `${e.event} ${e.key}`);
    expect(all.sort()).toEqual([
      "comment.added CB-1",
      "ticket.created CB-2",
      "ticket.created OPS-1",
    ]);
  });

  it("sends resync for a Last-Event-ID that is not an Activity id", async () => {
    const t = buildTestApp();
    const { owner } = await setup(t);
    await createTicket(owner.request, { projectKey: "CB", title: "Login breaks" });

    const reconnected = await openStream(owner.request, resumingFrom("not-an-id"));
    const first = await reconnected.nextEvent();
    const rest = await eventsUntilKeepalive(t, reconnected);
    await reconnected.close();

    expect(first.event).toBe("resync");
    expect(rest).toEqual([]);
  });

  it("resumes after a resync from the id the resync event carried", async () => {
    const t = buildTestApp({ config: { streamBacklogLimit: 1 } });
    const { owner } = await setup(t);
    const tab = await openStream(owner.request);
    await createTicket(owner.request, { projectKey: "CB", title: "Seen" });
    const lastSeen = await tab.nextEvent();
    await tab.close();
    await createTicket(owner.request, { projectKey: "CB", title: "One" });
    await createTicket(owner.request, { projectKey: "CB", title: "Two" });

    const resyncing = await openStream(owner.request, resumingFrom(lastSeen.id));
    const resync = await resyncing.nextEvent();
    await resyncing.close();
    await createTicket(owner.request, { projectKey: "CB", title: "After the refetch" });
    const resumed = await openStream(owner.request, resumingFrom(resync.id));
    const replayed = await eventsUntilKeepalive(t, resumed);
    await resumed.close();

    expect(resync.event).toBe("resync");
    expect(replayed.map((e) => e.key)).toEqual(["CB-4"]);
  });
});
