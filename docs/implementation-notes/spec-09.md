# Spec 09 implementation notes

Deliberate choices made while implementing Spec 09 (Ticket Labels and Progress). Reviewers: treat these as decided unless one contradicts the spec or an ADR.

## 09-01 Schema and glossary

- **One generated migration.** `packages/db/drizzle/0014_labels_and_progress.sql` and its snapshot come from `pnpm db:generate`, holding the `progress` column, the `label_color` enum, and both tables, so later cards add no migration.
- **The palette and the color pick live in `packages/shared/src/labels.ts`.** The `label_color` pgEnum is built from `labelColors`, like `ticket_link_kind` from `ticketLinkKinds`. `defaultLabelColor` hashes the normalized name (trimmed, lowercased) with a 31-multiplier string hash, so the server picks it and the web app could preview it the same way.
- **Case-insensitive uniqueness is an expression index**, `labels_company_name_unique` on `(company_id, lower(name))`. The stored name keeps its first spelling. `normalizeLabelName` (trim plus lowercase) is the JavaScript side of the same rule; names are trimmed by the input schema before they reach the database, so `lower(name)` alone is enough there.
- **`ticket_labels` has no Company column.** Both of its rows' parents already carry one, and every read goes through a Ticket or a Label. Its primary key `(ticket_id, label_id)` serves lookups by Ticket; a separate index on `label_id` serves the filter, the counts, and Label delete.
- **No `updated_at` on `labels`.** Rename and recolor record no Activity (spec) and nothing reads when they happened.
- **Glossary.** Label and Progress follow Blocked at the end of Board. Progress's _Avoid_ list is "completion, percent done": the spec's draft also avoided "status", but `scripts/check-copy.mjs` enforces every _Avoid_ term in copy, and "status" is the right word for Status everywhere. The Label definition avoids its own _Avoid_ term "tag".

## 09-02 Progress over REST and MCP

- **Built exactly like the Estimate.** `ticketProgress` in `packages/shared/src/tickets.ts` carries the one message "Progress is a whole number from 0 to 100." for every failure, refuses strings rather than coercing them, defaults to null on create, and is `nullable().optional()` on update. `updateTicket` needs no Progress branch: the field flows through `changedFields` into the `ticket.updated` diff as `progress`, and a no-op write records nothing.
- **Moves never touch Progress.** No code in `moves.ts` names it; the test walks a Ticket through every Status, Done included, as both a User and an Agent, and reads the same value back.
- **"N% done" in the ticket line, "Progress: N%" in get_ticket.** The ticket line puts it after the Estimate and before "blocked". get_ticket always says "Progress: none" when blank, matching "Estimate: none". 0 shows as "0% done", distinct from blank.
- **The nudge to report lives in three places.** The `progress` description on both write tools ends "Update it as you work.", `update_ticket`'s own description asks Agents to keep progress current while they work a Ticket, and step 4 of the Agent prompt asks for it. The prompt line is checked in `e2e/board.spec.ts` beside the prompt's other lines.
- **Tests in `apps/server/test/progress.test.ts`**, a sibling of `estimate.test.ts`, with the same User and Agent matrix plus the move case.
