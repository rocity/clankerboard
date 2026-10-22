# Ticket ranks use byte-order collation

`tickets.rank` holds fractional-index keys (the `fractional-indexing` package), which only sort correctly in byte order: `"aZ"` comes before `"aa"`. The column is declared `text COLLATE "C"`, so Postgres sorts ranks by byte on every host. Under a natural-language collation, as on glibc hosts and most managed Postgres, `ORDER BY rank` breaks once a Status holds roughly 36 Tickets. Alpine's Postgres image sorts by byte by default, which hid the bug.

## Consequences

- Any new column that stores fractional-index keys needs `COLLATE "C"` too. See `rankText` in `packages/db/src/schema.ts`.
- The compose `db-test` service runs with an ICU `en-US` collation, so ordering bugs like this one fail in tests rather than in production.
- Rank comparisons in TypeScript (`rankAt`) use plain string comparison, which matches byte order for these ASCII keys.
