# Coding Standards

The reviewer applies every rule below to each diff. Read the spec's `docs/implementation-notes/spec-NN.md` first: its choices are decided, so flag one only when it contradicts the spec or an ADR. These rules need judgement. Mechanical rules are enforced by `pnpm lint` (Biome, and `scripts/check-copy.mjs` for em dashes, emojis, and glossary _Avoid_ terms in copy).

## Language

- **Use GLOSSARY.md terms everywhere:** code names, routes, test titles, comments, and user-facing copy. Flag every _Avoid_ term.
  - `scripts/check-copy.mjs` already blocks _Avoid_ terms in user-facing strings, with exceptions in `scripts/copy-allowlist.json`. Review code names, routes, test titles, and comments, and check that each new allowlist entry really is a different concept.
- **Exceptions:**
  - `member` is a Company Role and a Team Role. Flag it only where it means a User.
  - `token` is fine for a rate-limit bucket token or an Invite link token. Flag it where it means an API Key.
- **Copy states a fact or an instruction once** (.claude/rules/user-facing-copy.md). Flag restating, padding, and justification the reader doesn't need.

## Layers (ADR-0004)

- **A route is a thin adapter.** It parses input, calls one domain service, and shapes the response.
- **The domain module owns the rules:** permission checks, Actor rules, and business rules. A future MCP tool must get the same behaviour by calling the same service.
- **Permissions:** each permission question has one function in `packages/domain/src/permissions.ts`. A new action adds a function there rather than an inline Role check.

## Tenancy and Actors

- **Scoping:** every Company-scoped query filters by `ctx.companyId`.
- **Another Company's resource is `notFound()`**, never `forbidden()`. Existence must not leak.
- **Agents (ADR-0003):**
  - `CompanyContext.userId` and `role` are the Agent owner's, read fresh on every request. Use them for permissions.
  - Credit actions to `ctx.actor`, the Agent itself.
- **Every hard delete calls `assertMayDelete(ctx)` first.**

## Secrets and time

- **Invite tokens and API Keys are stored only as hashes.**
  - They travel in request bodies or headers, never in URL paths or logs.
  - A secret is returned once, at creation.
- **The domain reads time from the injected `clock`**, so tests can drive it with the fake clock.

## Tests

- **Tests go through the HTTP seam** with `apps/server/test/harness.ts`.
- **A test observes effects through later requests**, never by reading tables.
- **Permission rules get table-driven tests** that cover every Role.
