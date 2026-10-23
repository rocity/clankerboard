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

## 09-03 Labels over REST

- **Module.** `packages/domain/src/labels.ts` owns the Label rules: `resolveLabels` (find or create by name), `labelChanges` (the diff), `setTicketLabels`, and the three management services. `labelsOf`, which `ticketViews` calls once per page, sits in `ticket-store.ts` beside `openBlockers`, so the Labels module can import the store without a cycle.
- **`labels` is replace-the-set on both create and update.** The input schema trims names, drops repeats without regard to case (the first spelling wins), and then checks the 10-Label cap, so `["ui", "UI"]` is one Label and never trips the cap. A plain string instead of a list gets "Labels are a list of names."
- **Find or create is one insert and one read.** `resolveLabels` inserts every name with `on conflict do nothing`, then reads the Company's Labels by `lower(name)`. An existing Label keeps its spelling and color, so `API` applied after `api` reuses `api`. `withActivity`'s per-Company advisory lock already serializes changes, so two concurrent creates of a name queue rather than race; the conflict clause is what makes the second a reuse, and the test fires both at once to prove it.
- **Labels are resolved before the "no changes" check in `updateTicket`.** A set equal to the current one, in any case or order, adds no `labels` entry and records nothing. A set with a new name creates that Label even when a later rule (the hierarchy) refuses the update; the transaction rolls the new Label back with it.
- **The diff stores names, sorted without regard to case.** `labels: { from: ["api", "web"], to: ["api", "docs"] }`. Names, not ids, so a Timeline still reads after a Label is renamed or deleted; it reads with the names the Labels had at the time. Sets are compared by Label id, so renaming a Label never makes a later no-op look like a change.
- **No `labels` in `ticket.created`.** The created payload records the fields the Timeline shows today; a Ticket's first Labels are visible on the Ticket itself. A reviewer who wants them in history can add `labels` to that payload in one line.
- **`label` filter.** One name, matched as `lower(name)` against the normalized input in a correlated `exists`, like `isBlocked`. It uses the `labelName` schema, so an empty or over-long value gets the same messages as applying one. An unknown name matches nothing, never errors.
- **Management.** `canManageLabels` (owners and admins) joins the shared Role matrix, and `assertMayManageLabels` in the domain refuses Agents first with "Agents can't change labels.", then members with the generic forbidden message, before looking the Label up, so a member learns nothing about which ids exist. A Label in another Company is not found.
- **Rename conflicts name the existing Label as spelled**: "A label named api already exists." Renaming to another case of its own name is allowed; the uniqueness check skips the Label itself.
- **Rename and recolor run under `withActivity` but record nothing.** The lock keeps a rename from racing a change that creates a Label of the new name, which would otherwise surface as a raw unique violation.
- **Delete bumps each carrier's `updatedAt`** before recording its `ticket.updated`, so the web app's "newer snapshot wins" check in `putTicket` treats the snapshot as the latest. Carriers are locked in id order, archived ones included, and the diff is recorded on each, credited to the deleting User.
- **`ticketCount` counts live Tickets only** (not archived), in every Project, since every User sees every Project today. A Label with no live Tickets is listed with 0 and kept: unused Labels go only by delete.
- **The stream test lives in `labels.test.ts`.** It checks one Label-and-Progress update and one delete reach the stream with fresh snapshots; there is no new stream code, since both are `ticket.updated`.
