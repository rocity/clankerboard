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
- **A Sprint's `state` keeps that name in code and JSON.** GLOSSARY.md avoids "state" for a Ticket's Status; a Sprint has no Status, and naming its Planned, Active, Finished lifecycle `status` would read as the Ticket workflow. Copy never says "state": it says planned, active, or finished.
- **Sprint Activity is Project Activity** (no Ticket), with `projectKey` and `number` in every payload, so a client can tell which Project's Sprints changed without looking the Project up.

## 10-03 Sprints over MCP

- **list_sprints takes a Project Key** and returns `sprintView` without its id and created time, since Agents name Sprints by number. Finished Sprints show only when they finished, since their live counts are always 0.
- **list_tickets takes `sprint` as JSON**: the strings `active` or `none`, or a number, where the REST query string takes text. It maps to the same `SprintFilter` the REST filter produces.
- **"sprint 4" sits right after the priority** in a ticket line's facts, before the Estimate. get_ticket says "Sprint: Sprint 4 (active)" or "Sprint: none". Summaries carry the number only, like Labels carry names only.
- **The board resource follows the web board.** A Project with no Sprints is unchanged. With an active Sprint, a line under the heading names it, its end date, and its goal, and only its Tickets are listed. With Sprints but none active, it says the board is empty and points at list_sprints, without the empty Status sections.
- **The nudge to stay in the Sprint** lives in list_tickets's description and step 1 of the Agent prompt, both conditional on the Project running Sprints, since `sprint: active` on a Project without Sprints lists nothing. The prompt's existing e2e check still matches its first half.
- **No tool changes a Sprint.** The exact tool list in `mcp-agent-loop.test.ts` gains only `list_sprints`, listed last in the registry.

## 10-04 The board in Sprint mode

- **The mode comes from the Project's Sprints** (`sprintMode` in `apps/web/src/lib/sprints.ts`): `off` with no Sprints (today's board), `active` with an active one, `idle` with Sprints but none active. The board route loads the Sprints with the Project and its Tickets, so the first paint is already in the right mode.
- **The active Sprint is a board filter the URL doesn't hold.** The route adds `sprint: "active"` to the filters it hands the Board, so the list endpoint narrows it and `ticketMatchesFilters` places live snapshots by the Sprint state they carry, without a refetch. "Clear filters" leaves it alone. A board in Sprint mode counts as filtered for moves, so a drop sends one neighbour, as any filtered view does.
- **Empty text.** "No tickets match these filters." only when a filter the viewer chose narrows the board; an empty active Sprint with no such filter says "No tickets in this sprint yet."
- **Idle shows no lanes and no filters,** only the bar: "No active sprint." and, when there is a Planned Sprint, "Start Sprint N to fill the board." with a Start sprint button for the lowest-numbered one, the Sprint a finish fills. Without a Planned Sprint it says to plan one; the Sprints page (10-06) is where.
- **The bar sits above the filters,** a bordered card in the page's own colors: the Sprint's name in bold, "Ends Nov 6" (or "Ended Nov 6" once that day has passed, by the viewer's local date) in muted text, the goal under it, and Finish sprint on the right, wrapping under on a phone.
- **Finish asks first, with counts from the board's live Tickets** (the unfiltered board query), not the Sprint view's counts, so they match what the viewer sees and follow live snapshots: "1 Done ticket is archived. 2 tickets move to Sprint 2." or "... to a new sprint." when none is Planned. The confirm button is the destructive one, as for other archives.
- **Start defaults its end date** with the same `defaultSprintEnd` the server uses, from the viewer's local "today" and the last finished Sprint's length. The date field is a native `type="date"` input (with the dark color scheme in dark mode), and the goal starts as the Sprint's own.
- **Live.** `sprint.*` events carry no Ticket; the app refetches that Project's Sprints and board from `payload.projectKey`. A finish's own `ticket.updated` and `ticket.archived` snapshots already move the cards before `sprint.finished` arrives. A resync refetches every Project's Sprints too.
- **Mutations refetch the same two queries** (`refreshSprints`), so the User who started or finished a Sprint sees the board change without waiting for their own event.

## 10-05 Sprint in Ticket detail, the create dialog, and the Timeline

- **Detail's Sprint select sits under Parent,** in the full-width block with Assignee, and saves on pick like the other selects. It shows once the Project has Sprints, or when the Ticket is in one. Its choices are "No sprint", the active Sprint marked "(active)", then the Planned Sprints by number (`openSprints`). It is disabled for an Epic and for an archived Ticket, matching the server's refusals; an archived Ticket whose Sprint finished shows it as "Sprint N (finished)".
- **The create dialog defaults to the active Sprint,** so a Ticket created from a board in Sprint mode lands on it. It shows only when the Project has open Sprints. Choosing Epic disables it (a disabled select sends nothing, which the dialog reads as no Sprint); the select is keyed by "is it an Epic", so switching back restores the default.
- **Timeline copy:** "moved this to Sprint 2", "moved this from Sprint 1 to Sprint 2", "removed this from Sprint 2"; a finish's archive reads "archived this ticket when Sprint 1 finished"; a restore out of a finished Sprint reads "restored this ticket and removed it from the finished Sprint 1". "Took this out" from the spec's draft became "removed this from", since "take" is avoided copy.
- **No live code.** A Sprint change is `ticket.updated` with a snapshot, which every board view already places through `ticketMatchesFilters`, now Sprint-aware.

## 10-06 Sprints page

- **Route.** `apps/web/src/routes/$companySlug/projects/$projectKey_.sprints.tsx`, at `/:company/projects/:key/sprints`. The trailing underscore keeps it out of the board route, which would otherwise mount the board (and its live drag handlers) behind it. Ticket rows link to the board's Ticket route, which opens the Ticket over its board as anywhere else.
- **Ways in:** a "Sprints" link under the Project's name on every board, beside its Team, and "Plan sprints" on the Sprint bar when no Sprint is active and none is Planned.
- **Order:** the active Sprint, the Planned Sprints by number, "No sprint", then Finished Sprints newest first. A Project with no Sprints says what having one does to the board.
- **Everything is counted from the board's live Tickets** (the unfiltered board query), grouped by each snapshot's Sprint, rather than from the Sprint view's counts. The page then follows live changes through the same snapshots the board does, without refetching the Sprints on every Ticket event. Rows are in board order (Status, then rank).
- **"No sprint" leaves out Epics,** since they can never be planned into a Sprint; they stay on the board.
- **Each row has a Sprint select** (No sprint, the active Sprint, the Planned ones) labelled "Sprint for PLAT-4", which saves on pick, shows the pick while the request is out, and shows the server's refusal under the row. It is the spec's quick, phone-friendly move; drag and drop between Sprints is out of scope.
- **Create sprint makes one straight away,** Planned with no goal, numbered by the server; the goal is edited on its card. There is no create dialog to fill in.
- **The goal is a one-line field** on each open Sprint's card, saved on Enter or blur and put back on Escape, like a Label's name.
- **Start sprint shows only while no Sprint is active,** so the button is never there to be refused. Finish sprint and Start sprint are the same components as on the board's bar.
- **Delete is for Planned Sprints,** an icon button named "Delete Sprint N" with a confirmation that says where its Tickets go: "Its 2 tickets go back to no sprint."
- **Finished Sprints are a plain list:** name, "Finished Oct 9", and the goal. Their Tickets were archived or moved, so there is nothing to list under them.
