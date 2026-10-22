# Spec 05 implementation notes

Deliberate choices made while implementing Spec 05 (Realtime Updates). Reviewers: treat these as decided unless one contradicts the spec or an ADR.

## 05-01 Live SSE stream

- **Route:** `GET /api/stream`, behind `authenticate` and `requireCompany` like every Company-scoped route. So a session needs an active Company (400 "Pick a company first." otherwise) and a bearer API Key streams its Agent's Company. Not `/api/events` or `/api/activity`, to keep "event log" out of the vocabulary.
- **Bus interface:** `EventBus` (domain) gained `subscribe(companyId, listener) => unsubscribe`. Listeners take an `ActivityEvent` only; 05-03 widens what the bus carries.
  - `InProcessEventBus` (domain, `event-bus.ts`) is the v1 implementation and the default in `createApp`. `noopEventBus` is gone, since an app without a real bus would have a dead stream.
  - Listeners run synchronously inside `publish` (after commit). One that throws is logged ("event listener failed") and the others still run, so a broken subscriber never turns a committed change into a 500.
  - The test `CapturingEventBus` now extends `InProcessEventBus`, so tests that capture events also get a working stream.
- **Permission filter:** REST has no named "may read" function; its reads are Company-scoped queries. The stream applies the same answer twice:
  - `canSeeActivity(ctx, activity)` in `permissions.ts` (same Company), for every event, including Project Activity that has no Ticket.
  - The Ticket snapshot is read with `findTicketById(db, ctx, ...)`, the subscriber's own Company-scoped read, as REST's Ticket reads do. A future visibility rule added to those reads applies to the stream too.
  - Each subscriber does its own read (actor names and the snapshot), not one shared per event. That keeps the check per subscriber at a cost of a few queries per event per open stream, fine for v1 tab counts.
- **Event data** is `{ activity, ticket }` (`streamedActivity` in `packages/shared/src/views.ts`). `activity` carries `id`, `kind`, `projectId`, `ticketKey`, the resolved `actor` view, `payload`, `createdAt`.
  - For a hard delete, `ticket` is null and the key is `activity.ticketKey`. Project Activity also has `ticket: null` (and `ticketKey: null`). One shape, rather than a separate `ticketKey` field that only deletes carry.
  - `comment.added` carries the snapshot and `payload.commentId`, not the Comment body. The spec asks for the Activity and the Ticket only.
- **Snapshot is "now", not "at the change":** it is read when the event is sent, after commit, so a quick second change can already be in the first event's snapshot. Clients patch toward the latest state either way, and 05-02 replay can only read current state, so live and replay agree. Building snapshots inside `withActivity`'s transaction would have cost every write extra queries even with no one watching.
- **Ticket gone before sending:** if the snapshot read is not found, the event is skipped. Under the current rules that only means the Ticket was hard-deleted since, and its `ticket.deleted` event follows.
- **Ordering:** each open stream has one promise chain. Bus events and keepalive ticks are appended to it, so events leave in publish order even though each needs a database read first. Publish order is commit order, which may differ from id order (Spec 05 Further Notes); that matters for 05-02, not live delivery.
- **Failures close the stream** (logged as "live stream failed") rather than skipping the event, so a client reconnects instead of silently missing it.
- **Subscribe before responding:** the route opens the subscription synchronously inside `streamSSE`, before the response is returned and before the `retry:` line is written. A caller that changes something right after the stream opens always sees it.
- **Keepalive:** `: keepalive` comment every 20 seconds (`keepaliveMs`), on the injected clock. `Clock` gained `every(ms, callback) => cancel` (`setInterval` in `systemClock`); the test `FakeClock.advance` fires each timer that comes due, in order, with `now()` set to its due time.
- **Retry and headers:** the stream opens with `retry: 3000`. `X-Accel-Buffering: no` is set for nginx-style proxies; Hono's `streamSSE` sets `Content-Type: text/event-stream` and `Cache-Control: no-cache`. There are no operator docs yet; when they exist, they must say to turn off proxy buffering for `/api/stream`.
- **Shutdown:** `AppDeps.shutdown` is an `AbortSignal`; `main.ts` aborts it on SIGTERM/SIGINT and `StreamManager.closeAll()` ends every stream. Without it `server.close()` would wait on open streams until the container is killed.
- **Disconnects:** the stream closes (unsubscribes, stops its keepalive) when the response body is cancelled or the request signal aborts.
- **No bound on a slow client's queue:** a client that stops reading stalls its own chain and its events pile up in memory. Other streams are unaffected. A cap (for example, close the stream and let the client resync) can come with 05-02.
- **Tests** (`apps/server/test/stream.test.ts`) read the stream in-process through `openStream` in the harness, and make changes through REST and MCP. "Nothing crossed" is shown with a keepalive tick as a sentinel: it queues behind every event already published, so a stream reaching it next had nothing else coming.
