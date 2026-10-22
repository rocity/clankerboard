# Better Auth in Agent Kanban

How we use Better Auth (ADR-0005), and the gotchas that its config won't tell you. Read before touching `apps/server/src/auth.ts` or any Better Auth table in `packages/db/src/schema.ts`.

## What it owns, what we own

- **Better Auth owns:** sign-up, sign-in, sessions, OAuth, and the schema of `users`, `sessions`, `accounts`, `verifications`, `companies`, `memberships`, `invites`, `teams`, `team_memberships`.
- **The domain module owns:** every tenancy rule. Domain services read and write the organization tables directly with Drizzle.
- **Blocked endpoints:** Better Auth's `/api/auth/organization/*` endpoints always return 404 (`createApp`). They would bypass the last-owner rule, the Role matrix, hashed Invite tokens, and the member-removed hook. Keep them blocked.
- **What the organization plugin still gives us:** its tables, and `session.activeOrganizationId`, which is the active Company.

## The schema check

On first use, the Drizzle adapter compares `packages/db/src/schema.ts` with what Better Auth expects. A mismatch throws `SchemaMismatchError`, and every auth request returns a bare 500. Run the test with `CB_TEST_LOG=debug` to see the findings. It flags:

- **A missing table or column Better Auth expects**, even one we never use. That is why these exist:
  - `invites` exists from 01-04, before Invites shipped.
  - `teams.member_count` stays at its default; count `team_memberships` instead.
  - `team_memberships.membership_key` and `sessions.active_team_id` are never set.
  - `invites.team_id` exists once teams are enabled.
- **A NOT NULL column Better Auth doesn't know about.** Declare it as an `additionalFields` entry with `input: false`, as `invites.tokenHash` is. `teamMember` accepts no `additionalFields`, so give our columns there a DB default (`team_memberships.role`).

## Naming

- **Model keys:** the adapter maps Better Auth's model names (`user`, `organization`, `member`, `invitation`, `team`, `teamMember`) to our tables in `createAuth`. Our table and column names follow GLOSSARY.md.
- **Field renames:** these go in the plugin config, for example `member: { fields: { organizationId: "companyId" } }`.
- **The returned session:** it still uses Better Auth's logical name, `session.activeOrganizationId`. Read it in the auth middleware only.

## Sign-up gating

- **The hook:** `user.validateUserInfo` with `source.action === "create-user"` runs for email and OAuth sign-ups alike. It calls the domain's `isSignUpAllowed`.
- **Where the Invite token comes from:**
  - Email sign-up sends it in the `x-invite-token` header.
  - OAuth sign-up carries it in the `cb_invite` cookie, because it arrives on a redirect.
  - Never put it in the `callbackURL` of `signIn.social`. Better Auth stores that URL with the OAuth state and sends it back in a redirect, so the token would sit in the database in plaintext. The Invite page asks for `/invite` and reads the token from the cookie on return.

## Sessions and the clock

- **Better Auth reads the real clock, not the injected `Clock`.** It sets `sessions.expires_at` 7 days from the real now and extends it as the session is used. The test `FakeClock` starts at 2026-01-01, so no API call brings an expiry within reach of `FakeClock.advance`.
- **To test expiry:** write `sessions.expires_at` directly in the database, then check the effect through the API (as `apps/server/test/stream-revocation.test.ts` does).
- **Read expiry fresh from `sessions`** rather than caching the value seen at sign-in, since Better Auth moves it forward.
