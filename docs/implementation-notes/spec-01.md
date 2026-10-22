# Spec 01 implementation notes

Deliberate choices made while implementing Spec 01 (Foundation and Tenancy). Reviewers: treat these as decided unless one contradicts the spec or an ADR.

- **Better Auth endpoints:** `/api/auth/organization/*` always returns 404. The domain module writes Better Auth's tenancy tables directly, so the last-owner rule, the Role matrix, hashed Invite tokens and the member-removed hook can't be bypassed. See docs/better-auth.md.
- **Active Company:** the active Company lives on the session. `/api/company`, `/api/members`, `/api/teams` and `/api/invites` act on it. Switching to a Company you don't belong to is 404.
- **Invite link shape:** links are `/invite#<token>`, and lookup and accept send the token in the request body. Neither the URL nor the request log ever holds a token.
- **Expiry:** "expired" is derived (pending and past `expiresAt`), not stored. Resend revives an expired Invite. An expired Invite can still be revoked.
- **Existing members:** a Company Invite to an existing member is 409. A Team Invite to an existing member is allowed and keeps their Company Role.
- **Team lead Invites:** leads may invite new emails to their own Team, always as members (ADR-0006). They see and manage their own Teams' Invites only.
- **Auth secret:** when `AUTH_SECRET` is unset, the app generates one on first boot and keeps it in `instance_settings`. That makes `docker compose up` work with no setup and no known default secret.
- **OAuth sign-up through an Invite:** the token travels in the `cb_invite` cookie, because the OAuth callback arrives on a redirect. Email sign-up uses the `x-invite-token` header.
- **Team names:** unique per Company, ignoring case.
- **Test helper:** `createCompany` adds members through the real Invite API.
