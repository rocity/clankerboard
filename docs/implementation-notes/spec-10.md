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

## 10-02 Sprints over REST

- **Module.** `packages/domain/src/sprints.ts` owns every Sprint rule, including `resolveSprint`, the placement check `createTicket` and `updateTicket` call. `sprintsOf` (number and state by id) sits in `ticket-store.ts` beside `labelsOf`, so `ticketViews` and `restoreTicket` read it without importing the Sprints module.
- **Sprints are addressed by Project Key and number** (`/api/projects/CB/sprints/4`), the way Agents and humans name them, not by id. A number that isn't a whole number from 1 is not found, like an unknown one. The routes live in `routes/projects.ts` so `/projects/*` checks the Company once.
- **Tickets carry `sprint: { number, state }`.** The state lets the web board decide whether a live snapshot belongs on an "active Sprint" view without a refetch.
- **Finishing reuses the archive steps.** `archiveTicket`'s body became `archiveRow` in `archive.ts`, exported for this use: it detaches children, records `ticket.archived` (with `sprint` added to the payload when a finish did it), and watches dependents. Moving the rest is one bulk update and one `ticket.updated` per Ticket, so a finish of many Tickets stays a handful of queries plus the Activity.
- **Order of a finish's Activity:** a new Sprint's `sprint.created` (when one is made), then each Done Ticket's archive, then each moved Ticket's `ticket.updated`, then `sprint.finished`, which lists the archived and moved keys and the next number. Clients that refetch on `sprint.finished` see the end state.
- **The next Sprint is locked** (`for update`) while it is chosen, and a new one takes its number from the Project row, as Tickets do.
- **Archived Tickets in a finishing Sprint stay with it.** They were already off the board. Restoring one of them later brings it back in no Sprint, and the `ticket.restored` payload says `{ sprint: N }`. A Ticket restored while its Sprint is still open keeps it.
- **Changing an archived Ticket's Sprint is refused** ("Restore CB-4 before changing its sprint."), unlike its Labels or Estimate, so an archived Ticket's Sprint always says where it was when archived.
- **Type change to Epic while in a Sprint is refused**, with "Remove CB-4 from Sprint 4 before making it an epic." Sending `type: "epic"` and `sprint: null` together is allowed. "Take ... out" was the spec's draft; "take" is avoided copy (it means Claim).
- **"You can delete only a planned sprint."** The spec's draft said "can be deleted"; "deleted" is avoided copy (it means Archived), so the sentence uses the verb.
- **Every User may manage Sprints, so there is no Role function.** `assertMayManageSprints` in the domain only refuses Agents. Delete also calls `assertMayDelete`, as every hard delete does.
- **Dates.** `startedAt` and `finishedAt` are the clock's moments; `endsOn` is compared with the start's UTC date, so "today" is the server's UTC day. A Sprint may end the day it starts. The default length is the last finished Sprint's start date to its end date, at least one day.
- **Updating with nothing new records nothing**, like Tickets. Setting the same Sprint on a Ticket again records nothing either.
- **The `sprint` list filter** is `active`, `none`, or a number up to nine digits. A number matches the Sprint of that number in each Ticket's own Project, so it needs no Project Key. It is a correlated `exists`, like `isBlocked` and the Label filter.
- **Sprint Activity is Project Activity** (no Ticket), with `projectKey` and `number` in every payload, so a client can tell which Project's Sprints changed without looking the Project up.
