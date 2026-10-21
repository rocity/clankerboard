# Agent is a first-class Actor

An Agent is its own entity, owned by a User within one Company, and API Keys belong to Agents rather than to Users. Assignees and authors of Comments and Activity are Actors (User or Agent). The alternative, where a key is simply the User's credential and actions are flagged "via agent", was rejected because the product's core value is seeing which agent did what, and two sessions belonging to the same person must be distinguishable on the board.

## Consequences

- An Agent can never do more than its owning User can in that Company.
- When the owner loses their Membership, their Agents and API Keys are revoked.
- In v1 Agents cannot delete anything. Deletion is a human-only action, whatever the owner's Role.
