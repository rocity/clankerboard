# Spec 10 implementation notes

Deliberate choices made while implementing Spec 10 (Sprints). Reviewers: treat these as decided unless one contradicts the spec or an ADR.

## 10-01 Schema and glossary

- **One generated migration.** `packages/db/drizzle/0015_sprints.sql` and its snapshot come from `pnpm db:generate`: the `sprint_state` enum, the `sprints` table, `projects.next_sprint_number`, and `tickets.sprint_id`.
- **The states live in `packages/shared/src/sprints.ts`** (`sprintStates`), and the pgEnum is built from them, like `label_color` from `labelColors`.
- **One Active Sprint per Project is a partial unique index**, `sprints_one_active_per_project` on `project_id` where `state = 'active'`, so two concurrent starts can't both win even if the domain check were skipped.
- **Dates match the state by one check**, `sprints_dates_match_state`: Planned has no dates, Active has a start and an end and no finish, Finished has all three.
- **The end is a `date`, not a timestamp** (`ends_on`, read as a `YYYY-MM-DD` string). A Sprint ends on a day, and a date avoids picking a time of day for it. The start and finish are timestamps, since they are moments someone acted.
- **`tickets.sprint_id` is set null on delete.** Deleting a Planned Sprint records a diff on each of its Tickets first (10-02); the cascade is the backstop when a whole Project goes.
- **No Company check ties a Ticket's Sprint to its Project in the schema.** The Sprints module is the only writer and checks the Project, like `parent_id`.
- **Glossary.** Sprint follows Progress at the end of Board. Its _Avoid_ list is "iteration, timebox". "Cycle" is not on it: Ticket Links already use it for a chain of Blocks. The definition says a Ticket in no Sprint is never "the backlog", since Backlog is a Status.
