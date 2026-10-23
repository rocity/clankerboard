# Spec 09 implementation notes

Deliberate choices made while implementing Spec 09 (Ticket Labels and Progress). Reviewers: treat these as decided unless one contradicts the spec or an ADR.

## 09-01 Schema and glossary

- **One generated migration.** `packages/db/drizzle/0014_labels_and_progress.sql` and its snapshot come from `pnpm db:generate`, holding the `progress` column, the `label_color` enum, and both tables, so later cards add no migration.
- **The palette and the color pick live in `packages/shared/src/labels.ts`.** The `label_color` pgEnum is built from `labelColors`, like `ticket_link_kind` from `ticketLinkKinds`. `defaultLabelColor` hashes the normalized name (trimmed, lowercased) with a 31-multiplier string hash, so the server picks it and the web app could preview it the same way.
- **Case-insensitive uniqueness is an expression index**, `labels_company_name_unique` on `(company_id, lower(name))`. The stored name keeps its first spelling. `normalizeLabelName` (trim plus lowercase) is the JavaScript side of the same rule; names are trimmed by the input schema before they reach the database, so `lower(name)` alone is enough there.
- **`ticket_labels` has no Company column.** Both of its rows' parents already carry one, and every read goes through a Ticket or a Label. Its primary key `(ticket_id, label_id)` serves lookups by Ticket; a separate index on `label_id` serves the filter, the counts, and Label delete.
- **No `updated_at` on `labels`.** Rename and recolor record no Activity (spec) and nothing reads when they happened.
- **Glossary.** Label and Progress follow Blocked at the end of Board. Progress's _Avoid_ list is "completion, percent done": the spec's draft also avoided "status", but `scripts/check-copy.mjs` enforces every _Avoid_ term in copy, and "status" is the right word for Status everywhere. The Label definition avoids its own _Avoid_ term "tag".
