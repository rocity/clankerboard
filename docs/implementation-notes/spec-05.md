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

## 05-03 Close streams on revocation

- **A second bus channel, not a wider Activity listener:** `EventBus` gained `publishRevocation` and `subscribeRevocations`. A `Revocation` is `{ companyId, actor }`. Activity listeners stay `ActivityEvent`-only, so 05-02's replay code and every Activity subscriber are untouched.
  - The `StreamManager` subscribes once, for all Companies, and closes the matching streams it holds. Revocations are rare, so one process-wide listener beats one per stream.
  - Published after the change commits, by `removeMember`, `revokeAgent`, and `revokeApiKey`, so a change that rolls back closes nothing. Revoking something already revoked publishes again; it finds no stream to close.
- **Who a Revocation closes:**
  - A removed member (`actor.type === "user"`): every stream in that Company whose `ctx.userId` is theirs. That covers their own session streams and their Agents' streams, since an Agent's `ctx.userId` is its owner and the member-removed hook revokes those Agents in the same transaction. The hook does not publish its own Revocations, because hooks run inside the transaction.
  - A revoked Agent or key (`actor.type === "agent"`): every stream of that Agent. Revoking one key closes the Agent's streams on its other keys too, as the ticket says ("closes that Agent's streams"). Those reconnect at once and pass authentication. Closing only the revoked key's streams would need the key id threaded into every stream; not worth it for v1.
  - Streams in other Companies are never touched, including the removed User's own streams elsewhere.
- **No event before a revocation close:** the stream just ends, as the ticket asks only expiry for an auth error event. The browser's reconnect then fails on its own: a removed member's session has no active Company any more (400), and a revoked key gets 401. Queued events not yet sent are dropped, since the subscriber no longer has access.
- **Session expiry is read from the database on every tick:** `isSessionLive(deps, sessionId)` (domain, `context.ts`) reads the session's `expiresAt` and compares it to the injected clock. Not the expiry captured at connect, because Better Auth extends a session's expiry as it is used; a captured value would send an active User to sign-in. One query per open session stream every 20 seconds.
  - A session that no longer exists (signed out) also counts as expired and closes the same way.
  - API Key streams have no expiry check; their end comes through revocation.
- **The auth error event:** `event: unauthorized`, data `{"error":"Your session expired. Sign in again."}`, the shape of a 401 body. It carries no `id`, so the client's Last-Event-ID still names the last Activity it saw. Named `unauthorized`, not `error`, because a browser `EventSource` already fires its own `error` event when a connection drops. `StreamSink.event`'s `id` became optional for it.
- **Session id reaches the stream as an option:** `StreamManager.open(ctx, sink, log, { sessionId })`. The route passes it for session callers only.
- **Test arrangement writes `sessions.expires_at` directly:** Better Auth stamps expiry on the real clock, days ahead of the fake clock, so no API call can bring it within reach of a keepalive tick. The outcome is still observed only through the stream. Tests are in `apps/server/test/stream-revocation.test.ts`, apart from `stream.test.ts`, to keep clear of 05-02's edits.
