# Blocked is derived, and its transitions are Activity on the dependent

A Ticket is Blocked while at least one Ticket blocking it is neither Done nor archived (Spec 07). Blocked is not stored. It is computed wherever Ticket views are built (`openBlockers` in `packages/domain/src/ticket-store.ts`) and as a SQL condition (`isBlocked`) where a query must filter on it: the list's `blocked` filter and Claim's conditional update. A stored flag would have to be rewritten on every Status move, archive, restore, and hard delete of any blocker, and on every Blocks Link added or removed, and a missed path would leave it wrong with nothing to correct it.

Deriving it leaves one gap: the dependent's row never changes when its blocker does, so nothing would record or stream that it became Blocked or unblocked. So every change that can flip another Ticket's Blocked state (a blocker moving into or out of Done, being archived, restored, or hard-deleted, and a Blocks Link being added or removed) notes each dependent's state before the change and records `ticket.blocked` or `ticket.unblocked` on each one that flipped, in the same transaction. The Activity is credited to the Actor who made the change and carries the causing Ticket's key and a reason (`done`, `reopened`, `archived`, `restored`, `deleted`, `linked`, `unlinked`). This follows `ticket.detached`, recorded on each child when its Parent is archived or deleted.

## Consequences

- An Actor's one request can record Activity on Tickets it never named. The Timeline of a dependent explains why its state changed, and the live stream carries the dependent's fresh snapshot with that Activity, so open boards update without a reload or a separate "Blocked changed" event.
- A new way to change a blocker's Status or archived state, or to add or remove Blocks Links, must call `watchDependents` or `watchBlocked` in `packages/domain/src/blocked.ts`, or dependents flip silently: the derived state stays correct, but no Activity is recorded and no snapshot is streamed.
- Moving Blocked to a stored column later is a schema change only. Tests assert on what the API returns and records, never on how Blocked is computed.
