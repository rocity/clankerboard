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

## 04-04 list_tickets and board resource

- **Urgency order without touching REST:** `listTickets` takes an optional `{ order, doneSince }` beside the query. `order: "urgency"` sorts (Status, priority descending, rank, number, id); the default `board` keeps the REST order (Status, rank, number, id). It is not a query parameter, so `/api/tickets` is unchanged.
- **Cursors carry their order:** a cursor from one order is "That page cursor is not valid." in the other. The urgency keyset is spelled out with `or`/`and`, since priority sorts the other way from the rest.
- **list_tickets input** reuses `listTicketsQuery` fields. Archived Tickets are always excluded (no `archived` input), and `teamId` is not offered. The limit defaults to 20 and caps at 100, below REST's 50 and 200, to save context.
- **Assignee filter** takes the REST forms (`unassigned`, `agents`, `users`, `user:<id>`, `agent:<id>`) plus `me` for the calling Agent. Filtering by Agent name or User email is not offered yet.
- **Output** is a summary per Ticket (key, title, type, status, priority, assignee, parent), not the full view, and the Markdown ends with the next cursor when there is one.
- **Board resource:**
  - Same urgency order as `list_tickets`, so both agent views agree. It reads every page, so the board is never cut off.
  - "Old" Done means `updatedAt` before the window, so a Done Ticket edited recently stays. The window is `BOARD_DONE_WINDOW_DAYS` (default 14), in `AppConfig.boardDoneWindowMs`.
  - The template's list callback offers one board per Project, so clients can browse boards.
  - Errors are protocol errors, not tool errors: unknown, malformed, and other-Company Project Keys are `ResourceNotFoundError` with "Not found." (the SDK sends it as -32602 with the uri). Other DomainErrors are invalid params; anything else is logged and "Something went wrong.".
