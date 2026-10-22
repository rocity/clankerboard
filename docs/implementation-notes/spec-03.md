# Spec 03 implementation notes

Deliberate choices made while implementing Spec 03 (Board Core). Reviewers: treat these as decided unless one contradicts the spec or an ADR.

- **Timeline:** `/tickets/:key/timeline` is one query: Activity in id order, left-joined to Comments. A `comment.added` Activity appears as the Comment itself.
- **Moves:** the input is `{ status?, after?, before?, position? }`.
  - With both `after` and `before`, they must still be adjacent, or the move is 409.
  - A neighbour in another Status is 400.
  - With no place given, the Ticket goes to the bottom.
- **Ranks:** fractional-index keys in a `text COLLATE "C"` column (ADR-0008).
- **List order:** (Status, rank, number, id), paged with a keyset cursor. Search results are filtered, not ranked by relevance.
- **List filters:** `assignee` is `unassigned`, `agents`, `users`, `user:<id>` or `agent:<id>`. `archived` is `exclude` (the default) or `include`.
- **Assigning:** an Actor outside the Company is 404. A revoked Agent is 400.
- **Archiving:**
  - Agents can't archive or restore (403).
  - An archived Ticket can't become a new Parent. Edits and Comments on archived Tickets are still allowed.
  - Archived children count when checking a type change.
- **Hard deletes:**
  - A Ticket's hard delete records a project-level `ticket.deleted` Activity holding only the Ticket Key.
  - A Project's `project.deleted` Activity is published to the event bus, but its row goes with the Project.
- **Actor references** use `ON DELETE RESTRICT` (ADR-0007).
- **Response shapes:** zod schemas in `packages/shared/src/views.ts`, with timestamps as a codec (Date in code, ISO string in JSON Schema). The domain view types derive from them.
- **Known gap for Spec 05:** Activity ids are allocated in order, but transactions can commit out of order. See the note in Spec 05.
