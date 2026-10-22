# Activity outlives its Actors

Every column that points at an Actor uses `ON DELETE RESTRICT`: Ticket creators and Assignees, Comment authors, Activity Actors, an Agent's owner, and an API Key's Agent. Deleting a User or an Agent that has any history therefore fails in the database. Cascading would quietly erase which Agent did what, the product's core value (ADR-0003). Revocation replaces deletion: a revoked Agent keeps its name and is shown as revoked wherever it appears.

## Consequences

- Nothing in v1 deletes Users or Agents. Removing someone from a Company revokes their Agents instead.
- Account deletion, if it is ever added, has to anonymise the User rather than delete the row.
- Hard-deleting a Ticket or Project still cascades to its own Comments and Activity, because purging that content is the point (Spec 03).
