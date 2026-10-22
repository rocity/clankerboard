# Spec 02 implementation notes

Deliberate choices made while implementing Spec 02 (Agents and API Keys). Reviewers: treat these as decided unless one contradicts the spec or an ADR.

- **One auth layer:** a request with an `Authorization` header is judged by its key alone and never falls back to the session cookie.
- **Human-only routes:** creating, listing or switching Companies, accepting Invites, and `/api/me` answer an Agent with 403 "Agents can't do this."
- **Agent visibility:** an Agent the caller can't see (another member's) is 404, not 403.
- **Revoking an Agent** also stamps `revokedAt` on all its keys.
- **The deletion guard (`assertMayDelete`)** covers removing a member, leaving, deleting a Team and removing a Team member. Revoking an Invite, Agent or API Key is not a delete.
- **Rate limit:**
  - Each bearer request spends from a bucket keyed by the hash of the presented key, before any database work.
  - A key that turns out invalid has its bucket dropped, so made-up keys can't grow memory. They still cost one indexed lookup each.
  - There is no per-IP limit, since that needs trusted proxy headers.
- **Last-used:** read during the key lookup and written only when it is a minute or more old. The UPDATE keeps its own condition, so concurrent requests write once.
- **Agent names:** unique per Company, ignoring case. A revoked Agent keeps its name reserved.
- **Config:** numeric env vars are validated at startup, and an empty value means the default.
