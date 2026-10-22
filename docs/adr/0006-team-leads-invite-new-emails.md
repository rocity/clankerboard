# Team leads may invite new emails

A Team lead can send a Team Invite to any email, not only to existing Company members. Accepting it creates the Company Membership, always with the member Role, as well as the Team Membership. Ticket 01-08 allowed this, while the first draft of Spec 01 gave new-email Team Invites to owners and admins only. We chose the ticket's version, so a lead can bring a new colleague onto their Team in one step, without waiting for an admin.

## Consequences

- A lead whose own Company Role is member can still add people to the Company. Those people only ever join as members, on the lead's Team.
- Leads can resend and revoke their own Teams' Invites and see them in the Invite list, but cannot see Company-only Invites.
- `canInviteToTeam` in `packages/domain/src/permissions.ts` encodes the rule.
