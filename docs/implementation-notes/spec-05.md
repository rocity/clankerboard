# Spec 05 implementation notes

Deliberate choices made while implementing Spec 05 (Realtime Updates). Reviewers: treat these as decided unless one contradicts the spec or an ADR.

## 05-01 Live SSE stream

- **Route:** `GET /api/stream`, behind `authenticate` and `requireCompany` like every Company-scoped route. So a session needs an active Company (400 "Pick a company first." otherwise) and a bearer API Key streams its Agent's Company. Not `/api/events` or `/api/activity`, to keep "event log" out of the vocabulary.
- **Bus interface:** `EventBus` (domain) gained `subscribe(companyId, listener) => unsubscribe`. Listeners take an `ActivityEvent` only; 05-03 widens what the bus carries.
  - `InProcessEventBus` (domain, `event-bus.ts`) is the v1 implementation and the default in `createApp`. `noopEventBus` is gone, since an app without a real bus would have a dead stream.
  - Listeners run synchronously inside `publish` (after commit). One that throws is logged ("event listener failed") and the others still run, so a broken subscriber never turns a committed change into a 500.
  - The test `CapturingEventBus` now extends `InProcessEventBus`, so tests that capture events also get a working stream.
- **Permission filter:** one function, `canSeeProject(ctx, project)` in `permissions.ts`, that REST's Project and Ticket reads and the stream all call (see Review fixes; 05-01 first shipped a stream-only `canSeeActivity`). The stream applies it twice:
  - On the event's Project, for every event, including Project Activity that has no Ticket.
  - Through `findTicketById(db, ctx, ...)`, the subscriber's own read of the Ticket snapshot, as REST's Ticket reads do.
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
- **Retry and headers:** the stream opens with `retry: 3000`. `X-Accel-Buffering: no` is set for nginx-style proxies; Hono's `streamSSE` sets `Content-Type: text/event-stream` and `Cache-Control: no-cache`. `docs/self-hosting.md` tells operators to turn off proxy buffering for `/api/stream`.
- **Shutdown:** `AppDeps.shutdown` is an `AbortSignal`; `main.ts` aborts it on SIGTERM/SIGINT and `StreamManager.closeAll()` ends every stream. Without it `server.close()` would wait on open streams until the container is killed.
- **Disconnects:** the stream closes (unsubscribes, stops its keepalive) when the response body is cancelled or the request signal aborts.
- **No bound on a slow client's queue:** a client that stops reading stalls its own chain and its events pile up in memory. Other streams are unaffected. The spec does not ask for a cap, so none was built. Known follow-up: close a stream whose queue passes a limit and let the client reconnect (and catch up or resync).
- **Tests** (`apps/server/test/stream.test.ts`) read the stream in-process through `openStream` in the harness, and make changes through REST and MCP. "Nothing crossed" is shown with a keepalive tick as a sentinel: it queues behind every event already published, so a stream reaching it next had nothing else coming.

## 05-02 Catch-up and resync

- **Out-of-order Activity ids: advisory lock, not a replay window.** `withActivity` takes `pg_advisory_xact_lock(<activity namespace>, hashtext(companyId))` as its transaction's first statement, so changes in one Company run one at a time and Activity ids commit in id order.
  - A window before `Last-Event-ID` can't bound how late a slow commit lands, and it re-sends ids the client already has, which AC2 forbids unless the client de-duplicates.
  - Taken at the start, not at the first `record`. A lock taken mid-change, after the change already holds row locks, could deadlock with another change waiting on those rows.
  - Cost: Activity-writing changes in one Company serialize, including ones that end up recording nothing (a no-op update). Reads and changes in other Companies are not affected (a hash collision only serializes two unrelated Companies). Fine for v1 board write rates.
  - The lock lives in Postgres, so it still holds with several replicas (the LISTEN/NOTIFY follow-up).
- **`Last-Event-ID` reaches the stream as an option** next to 05-03's `sessionId`: `StreamManager.open({ ctx, sessionId, sink, log, resumeFrom })`, where the route parses the header into a `ResumePoint` (see Review fixes). The backlog limit is a `StreamManager` constructor option.
- **The stream's queue is the live buffer.** `StreamManager.open` with a `Last-Event-ID` enqueues the catch-up right after subscribing, so every live event published from then on queues behind it, and nothing can be published in between (it is all synchronous).
  - After the catch-up, a live event with an id at or below the last one the catch-up sent is dropped as already sent. A high-water mark rather than a set of sent ids, which is exact because of the lock. The mark is set only by the catch-up, never by live events.
- **Backlog read:** `activityBacklog` (`packages/domain/src/activity-backlog.ts`) reads the Company's Activity after the id, oldest first, through the `(companyId, id)` index, and shapes each row as the bus would have published it. Each row then goes through `streamedActivity` like a live event: same permission check, snapshot read as current state.
  - `ticketKey` is rebuilt from the Ticket's Project key and number (Project keys never change), or from `payload.ticketKey` for `ticket.deleted`.
  - Gaps are expected: hard deletes cascade their Ticket's or Project's Activity away, so a replay never sends `project.deleted` and never sends Activity of a Ticket deleted since.
- **Backlog limit:** `STREAM_BACKLOG_LIMIT` (`AppConfig.streamBacklogLimit`), default 500, at least 0. Zero means any missed Activity gets `resync`. It counts the Company's Activity rows before the permission filter. The query fetches limit + 1 rows to tell "exactly the limit" from "over it".
- **`resync` carries an id:** the Company's latest Activity id when the backlog was read, with data `{}`. Unlike 05-03's `unauthorized`, which has none.
  - The browser's `EventSource` adopts it as its last event id. After refetching, the client's next reconnect resumes from there instead of hitting the same oversized gap and resyncing forever.
  - Live events up to that id are dropped, since the refetch (made after the client receives `resync`) already reflects them. Live events after it carry on as usual.
  - Data is `{}` because browsers do not dispatch an SSE event with empty data.
- **Odd `Last-Event-ID` values:** anything but a whole number of up to 15 digits gets `resync`, because the client's position is unknown. An empty header counts as a fresh connect (browsers send none before their first id). An id beyond the newest Activity replays nothing.
- **Retention:** all Activity is kept (spec Out of Scope), so the "id older than retained Activity" case can't happen yet. When pruning lands, `activityBacklog` must also return `resync` for an id below the oldest kept row.
- **Tests** live in `apps/server/test/stream-replay.test.ts`, apart from `stream.test.ts`, so 05-02 and 05-03 could land in parallel.
  - A second tab that never disconnects is the independent record of what the reconnecting tab missed.
  - A `HeldEventBus` holds publishes back, to force the race where a change has committed (so the backlog has it) but its publish reaches the new subscription only after the catch-up.
  - The out-of-order case stalls a Comment after its Activity id is allocated: an outside transaction holds its Project row `FOR UPDATE`, which the Activity's foreign-key check waits on. The test polls `pg_stat_activity` for lock waiters rather than sleeping. Without the advisory lock, the later-numbered change commits first, the tab sees it, and the reconnect never sends the Comment.

## 05-03 Close streams on revocation

- **A second bus channel, not a wider Activity listener:** `EventBus` gained `publishRevocation` and `subscribeRevocations`. A `Revocation` was `{ companyId, actor }`; it is now a union that also carries Company switches (see Review fixes). Activity listeners stay `ActivityEvent`-only, so 05-02's replay code and every Activity subscriber are untouched.
  - The `StreamManager` subscribes once, for all Companies, and closes the matching streams it holds. Revocations are rare, so one process-wide listener beats one per stream.
  - Published after the change commits, by `removeMember`, `revokeAgent`, and `revokeApiKey`, so a change that rolls back closes nothing. Revoking something already revoked publishes again; it finds no stream to close.
- **Who a Revocation closes:**
  - A removed User (`actor.type === "user"`): every stream in that Company whose `ctx.userId` is theirs. That covers their own session streams and their Agents' streams, since an Agent's `ctx.userId` is its owner and the member-removed hook revokes those Agents in the same transaction. The hook does not publish its own Revocations, because hooks run inside the transaction.
  - A revoked Agent or key (`actor.type === "agent"`): every stream of that Agent. Revoking one key closes the Agent's streams on its other keys too, as the ticket says ("closes that Agent's streams"). Those reconnect at once and pass authentication. Closing only the revoked key's streams would need the key id threaded into every stream; not worth it for v1.
  - Streams in other Companies are never touched, including the removed User's own streams elsewhere.
- **No event before a revocation close:** the stream just ends, as the ticket asks only expiry for an auth error event. The browser's reconnect then fails on its own: a removed User's session has no active Company any more (400), and a revoked key gets 401. Queued events not yet sent are dropped, since the subscriber no longer has access.
- **Session expiry is read from the database on every tick:** `isSessionLive(deps, sessionId)` (domain, `context.ts`) reads the session's `expiresAt` and compares it to the injected clock. Not the expiry captured at connect, because Better Auth extends a session's expiry as it is used; a captured value would send an active User to sign-in. One query per open session stream every 20 seconds.
  - A session that no longer exists (signed out) also counts as expired and closes the same way.
  - API Key streams have no expiry check; their end comes through revocation.
- **The auth error event:** `event: unauthorized`, data `{"error":"Your session expired. Sign in again."}`, the shape of a 401 body. It carries no `id`, so the client's Last-Event-ID still names the last Activity it saw. Named `unauthorized`, not `error`, because a browser `EventSource` already fires its own `error` event when a connection drops. `StreamSink.event`'s `id` became optional for it.
- **Session id reaches the stream as an option:** `sessionId` in `StreamManager.open`'s options. The route passes it for session callers only.
- **Test arrangement writes `sessions.expires_at` directly:** Better Auth stamps expiry on the real clock, days ahead of the fake clock, so no API call can bring it within reach of a keepalive tick. The outcome is still observed only through the stream. Tests are in `apps/server/test/stream-revocation.test.ts`, apart from `stream.test.ts`, to keep clear of 05-02's edits.

## Review fixes

- **One visibility check: `canSeeProject(ctx, project)`** (`permissions.ts`) replaces the stream-only `canSeeActivity`. `findProject`, `listProjects`, `findTicket`, `findTicketById`, `listTickets`, and the stream all call it, so a narrower rule (such as Team-only Projects) added there reaches REST, MCP, and the stream at once. A Ticket is visible when its Project is.
  - It is a predicate run on rows the Company-scoped query already returned, not a SQL condition. The stream checks events in memory, and `project.deleted` arrives after its Project row is gone, so a query-shaped check could not cover it. The queries keep their `ctx.companyId` filter (CODING_STANDARDS, Scoping).
  - `listTickets` filters each page after taking its cursor, so hidden rows can shorten a page but never stop the list from continuing. A real narrower rule should also go into the query, for page sizes; until one exists the predicate always passes.
  - `apps/server/test/project-visibility.test.ts` is the table-driven test over every Role: each sees Project CB and Ticket CB-1 through REST and gets `project.*` and `ticket.*` events, and the same Role in another Company sees none of it. It passed before the refactor too; it pins the behaviour the refactor must keep.
- **Story 10, switching Company ends the session's other streams.** A `Revocation` is now `{ kind: "access-lost", companyId, actor } | { kind: "company-switched", sessionId, companyId }`. `switchCompany` publishes `company-switched` after its update, and closes the session's streams of every other Company; the browser reconnects and `requireCompany` puts the new stream on the new Company.
  - The same channel, not a third one: both mean "these open streams are no longer right", the `StreamManager` reacts the same way (close), and a future LISTEN/NOTIFY bus has one fewer channel to carry.
  - `createCompany` publishes it too, because it also makes the new Company the session's active one.
  - Switching to the Company a stream is already on closes nothing. Other sessions of the same User and the User's Agents keep their streams.
  - No event before the close, as with revocation: the reconnect is the switch.
- **The Revocation rule is a domain function:** `revokes(revocation, stream)` in `packages/domain/src/revocation.ts`, next to the `Revocation` type. `StreamManager` only loops and closes. `StreamSubscriber` (`{ ctx, sessionId? }`) is what the rule needs of a stream; `LiveStream` implements it.
  - `Revocation` lives in `revocation.ts` with its rule rather than in `event-bus.ts`, which now holds the bus types (`EventBus`, the listener types) and `InProcessEventBus`.
- **`ResumePoint`:** the route parses `Last-Event-ID` into `{ kind: "after", activityId } | { kind: "unknown" }` (or none for a fresh connect), and `activityBacklog` takes it. The parse rules are unchanged.
- **`StreamOptions`:** `StreamManager.open` and the `LiveStream` constructor take one options object (`ctx`, `sessionId`, `sink`, `log`, `resumeFrom`) instead of positional arguments plus an options bag.
- **Naming:** the backlog's `refetch` result is now `resync`, matching the event. `keyOf` in `activity-backlog.ts` is `activityTicketKey`. The second Agent in the revocation test is `Claude-2`, not `Mia-bot`.
- **Operator docs:** `docs/self-hosting.md` covers proxy buffering on `/api/stream` (`X-Accel-Buffering: no`, an nginx example, read timeouts) and `STREAM_BACKLOG_LIMIT`. It also says to run one replica while the bus is in-process.
- **Slow-client queue cap:** not built, since the spec does not ask for it. Recorded as a known follow-up in 05-01.
