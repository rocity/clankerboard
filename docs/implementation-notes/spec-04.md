# Spec 04 implementation notes

Deliberate choices made while implementing Spec 04 (MCP Endpoint). Reviewers: treat these as decided unless one contradicts the spec or an ADR.

## 04-01 MCP endpoint skeleton

- **SDK:** the v2 packages `@modelcontextprotocol/server` (and `@modelcontextprotocol/client` for tests), not the v1 `@modelcontextprotocol/sdk`. Its `createMcpHandler` serves the 2026-07-28 revision and falls back to stateless 2025 serving, so current clients work too. GET and DELETE on `/mcp` answer 405.
- **Auth:**
  - `/mcp` needs an `Authorization` header (otherwise 401), then reuses the `authenticate` middleware. The session cookie is never read.
  - The 401 has no `WWW-Authenticate` challenge, so clients don't start an OAuth flow (out of scope).
  - `/api` and `/mcp` share one rate limiter, so an Agent has one budget per key.
- **Per-request server:** the route passes the Agent's `CompanyContext` and the request log to the server factory through `authInfo.extra`. `authInfo.token` holds the key's id, never its secret.
- **Output schemas** are declared in wire form (timestamps as ISO strings), and structured content is `z.encode`d to match. The SDK would otherwise list the output side of the timestamp codec, which JSON Schema can't express.
- **Tool errors:** a DomainError becomes a tool error with its message. Any other error is logged and reported as "Something went wrong.". Input that fails a tool's schema gets the SDK's "Input validation error: ..." prefix before our zod message.
- **`get_ticket`** composes three domain reads (`getTicket`, `listChildren`, `listComments`) instead of a new domain service, since no rule is involved. Archived children are left out.
- **`list_projects`** returns only Project Key, name, and Team, to save context.
- **Read-only tools** carry `readOnlyHint: true`.
- **Version:** from `apps/server/package.json`, which now has a `version` (0.1.0). The bundle inlines it.

## 04-02

- **Inputs** extend the shared `createTicketInput`, `updateTicketInput`, and `addCommentInput` (adding `key` and per-field descriptions), so REST and MCP validate alike. `move_ticket` reuses `ticketStatus`.
- **`update_ticket` omits `type`.** The spec lists title, description, priority, and Parent only. `parentKey: null` clears the Parent.
- **`move_ticket` requires a Status** and passes no place, so the domain puts the Ticket at the bottom, also when the Status is unchanged. No `after`/`before`/`position` for Agents.
- **`add_comment` replies with a one-line confirmation**, not the body, since the model just wrote it. Structured content still carries the full Comment.
- **`update_ticket` and `move_ticket` reply with the Ticket's summary line** ("Updated **CB-1** [task, Backlog, medium, 40% done] Fix login (unassigned)"), and their structured content is the `list_tickets` summary, not the full view. Echoing the whole Ticket resent its description on every write, so an Agent setting Sprint, Status, and Progress on a Ticket with a long spec paid for that spec three times. Changed later than 04-02; `get_ticket` is the way to read the description back.
- **Annotations:** every write tool has `readOnlyHint: false, destructiveHint: false`. `update_ticket` is also `idempotentHint: true`.
- **Activity credit for Comments** is checked through the timeline's comment item (with its `activityId`), since a Comment stands in for its `comment.added` Activity there.
- **Rule-violation tests** pin the adapter: the domain's messages come back verbatim as tool errors, and the board is unchanged. Updating or commenting on an archived Ticket is allowed by the domain, so only moves and archived Parents are errors.

## 04-03 MCP assign and claim tools

- **`assign_ticket` takes one string handle** (or null), not a typed `{ type, id }`. The domain's new `findAssignee` matches the email of a User in the Company first, then an Agent's name, both ignoring case. The User wins if an Agent happens to be named the same as their email.
- **Unknown handles** (no such User or Agent, a User outside the Company, another Company's Agent) all read `No user or agent matches "<handle>".`, so nothing leaks across Companies. A revoked Agent is found, then refused by Assign's own rule ("That agent was revoked.").
- **User emails are in MCP output** (see "Review fixes" below), so an agent can pass a User it read about straight to `assign_ticket`.
- **Claim errors are the domain's copy** ("CB-3 is already held by Claude-2."), unchanged. The description tells the agent to pick another Ticket on failure.
- **Annotations:** `claim_ticket` is not idempotent (a second call fails); `assign_ticket` is.

## 04-04 list_tickets and board resource

- **Urgency order without touching REST:** `listTickets` takes an optional `{ order, doneSince }` beside the query. `order: "urgency"` sorts (Status, priority descending, rank, number, id); the default `board` keeps the REST order (Status, rank, number, id). It is not a query parameter, so `/api/tickets` is unchanged.
- **Cursors carry their order:** a cursor from one order is "That page cursor is not valid." in the other. The urgency keyset is spelled out with `or`/`and`, since priority sorts the other way from the rest.
- **list_tickets input** reuses `listTicketsQuery` fields. Archived Tickets are always excluded (no `archived` input), and `teamId` is not offered. The limit defaults to 20 and caps at 100, below REST's 50 and 200, to save context.
- **Assignee filter** takes the REST forms (`unassigned`, `agents`, `users`, `user:<id>`, `agent:<id>`) plus `me` for the calling Agent, and any other value as a User email or Agent name through `findAssignee`, like `assign_ticket` (see "Review fixes" below).
- **Output** is a summary per Ticket (key, title, type, status, priority, assignee, parent), not the full view, and the Markdown ends with the next cursor when there is one.
- **Board resource:**
  - Same urgency order as `list_tickets`, so both agent views agree. It reads every page, so the board is never cut off.
  - "Old" Done means `updatedAt` before the window, so a Done Ticket edited recently stays. The window is `BOARD_DONE_WINDOW_DAYS` (default 14), in `AppConfig.boardDoneWindowMs`.
  - The template's list callback offers one board per Project, so clients can browse boards.
  - Errors are protocol errors, not tool errors: unknown, malformed, and other-Company Project Keys are `ResourceNotFoundError` with "Not found." (the SDK sends it as -32602 with the uri). Other DomainErrors are invalid params; anything else is logged and "Something went wrong.".

## 04-05

- **Descriptions chain the loop:** each step names the tool for the next one (list_projects to list_tickets, list_tickets to claim_ticket, claim_ticket to add_comment, add_comment to move_ticket, which says to move to review). The test pins only those tool names and the AC phrases, not whole sentences, so copy can still be tuned.
- **"The next ticket" means To Do:** list_tickets says that with status todo and assignee unassigned the first result is the next ticket to claim. Backlog is treated as not ready. The smoke seeds an urgent Backlog bug to pin that.
- **The board resource is not named in tool descriptions.** Its URI contains "board", which the copy check rejects in prose (GLOSSARY: Project, avoid Board). Its own description says to read it before claiming, and clients list it from resources/templates.
- **The tool list test is exact:** it lists the nine v1 tools and checks that no name mentions delete, archive, restore, or remove, so a new tool has to update the test on purpose.
- **The smoke is a vitest test** (`apps/server/test/mcp-agent-loop.test.ts`), so it always runs in `pnpm test` (and CI) over the in-process app. It follows the idea.md prompt: orient, list unassigned To Do bugs, Claim the top one, comment, move to Review, reading the board resource after each step. A second case runs two agents at once and checks they Claim different bugs, as idea.md's two-agent test asks. Which agent loses the race is not asserted, since either order is valid.

## Review fixes

- **Emails only in MCP views:** `mcp/views.ts` extends the shared views (`mcpActorView` adds `email`, null for Agents) and `withEmails` fills them with one `memberEmails` query per tool call. The shared `actorView` and every REST response are unchanged. Markdown labels a User as "Ada (ada@example.com)".
- **Former members show no email.** `memberEmails` only returns Users still in the Company, which matches what `findAssignee` can resolve, so MCP never shows an email it can't act on.
- **list_tickets Assignee filter:** `me` first, then the REST forms, then anything else goes to `findAssignee`. So an Agent named `agents` or `me` can't be filtered by name; filter by `agent:<id>`. An unknown handle is a tool error ("No user or agent matches ..."), not an empty list, so a typo isn't mistaken for no work.
- **One Ticket summary shape** (`ticketSummary` in views.ts) for list_tickets, get_ticket children, and `ticketLine`. It includes the Parent, which is redundant for get_ticket's children but keeps one shape.
- **The board uses `ticketLine` without the Status**, since each Ticket sits under its Status heading.
- **The claim conflict message names the holder without an email.** It is the domain's copy, shared with REST.
- **`ticketKeyParam` upper-cases the key** (zod `toUpperCase`, which JSON Schema can still express), so tools echo `CB-42` however the model typed it, without the adapter normalizing again.
