# Spec 08 implementation notes

Deliberate choices made while implementing Spec 08 (Rebrand to Agent Kanban). Reviewers: treat these as decided unless one contradicts the spec or an ADR.

## 08-01 Product name in copy

- **One constant.** `productName` ("Agent Kanban") lives in `packages/shared/src/product.ts` and is exported from `@agentkanban/shared`. Brand, the header home link's `aria-label`, the Agent prompt, the invite email subject, and the default email sender read it. Tests assert the literal "Agent Kanban", not the constant, so a test can't pass by construction.
- **The HTML title is the one duplicated place.** `apps/web/index.html` is static and can't import the constant, so `<title>Agent Kanban</title>` is set by hand with a comment pointing at `product.ts`. A rename edits both, plus the glossary and the test expectations.
- **Config test is the only new test file.** `apps/server/test/config.test.ts` calls `loadConfig` directly with a plain env object. It needs no database, though Vitest's global setup still starts the test harness for the whole run.
- **E2E coverage extends existing specs.** `e2e/auth.spec.ts` checks the tab title, the sign-in wordmark, and the header home link by its accessible name (on both the desktop wordmark and the phone icon-only header). `e2e/board.spec.ts` checks the prompt's opening line.
- **Pre-existing failing viewport check.** `board.spec.ts` "fits the viewport ... all show on a desktop" fails on `desktop-light` (Done lane in view at ratio 0.96, not 1). It fails the same way on the base commit without these changes, so it is not caused by the rename and is left alone here.

## 08-02 Glossary and ADR

- **New "Product" section in GLOSSARY.md.** The **Agent Kanban** entry sits in its own section above Tenancy, since no existing section (Tenancy, Actors, Board, History) fits a product name. Everything else in the glossary is unchanged.
- **The _Avoid_ term is enforced by the copy check.** `scripts/check-copy.mjs` reads every _Avoid_ term from GLOSSARY.md, so `pnpm lint` fails on the old codename (any case) in multi-word strings and JSX text under `apps/*/src` and `packages/*/src`.
- **Known gap.** The copy check only scans text of two or more words, so single-word copy such as the Brand wordmark or the header link's `aria-label` would not be caught if it said the old name. The e2e assertions from 08-01 guard those.

## 08-03 Retire the codename

The spec's amendment reversed 08-01's choice to keep identifiers on the codename. [ADR 0010](../adr/0010-product-is-agent-kanban-everywhere.md) was rewritten in place, since it was never released.

- **Which test guards each renamed identifier.**
  - MCP server name `agentkanban` (`apps/server/src/mcp/server.ts`, `serverName` in `apps/web/src/lib/agent-setup.ts`): the server-name test in `mcp.test.ts`, and the `claude mcp add ... agentkanban ...` assertions in `e2e/board.spec.ts` and `e2e/agents.spec.ts`.
  - `AGENTKANBAN_API_KEY` (`keyEnvVar`): `e2e/agents.spec.ts`.
  - `agentkanban://projects/{key}/board`: the MCP board resource tests on the server side, and a new assertion in the Agent prompt dialog spec (`e2e/board.spec.ts`) on the prompt side.
  - `agentkanban-theme`: `e2e/theme.spec.ts`, which seeds and reads the key, so the inline script in `index.html` is covered too.
  - `agentkanban-last-company`, the package scope, Docker and database names, and test MCP client names: no dedicated test. The landing logic, every import, and the test harness depend on them.
- **ADR 0010 file renamed.** Its old slug said identifiers keep the codename, which is now false, so it is `0010-product-is-agent-kanban-everywhere.md`.
- **ADR renumbered from 0009 to 0010.** The spec asked for 0009, but Spec 07's Blocked ADR reached main first under 0009.
- **Codename in docs only as history.** `docs/self-hosting.md` gives the upgrade steps without spelling the old names, pointing at ADR 0010 for them, so the repo sweep (`git grep -i` for the codename) returns only the glossary's _Avoid_ entry and the ADR's history section.
- **Test fixtures renamed to "Agent Kanban".** The Projects named after the codename in `projects.test.ts` and `mcp-*.test.ts`, and the fixture title in `web-shell.test.ts`, now use "Agent Kanban". The space breaks nothing. The Project Key stays `CB`, which is fixture data, not the codename.
- **Copy allowlist entry removed.** The Agent prompt now names `agentkanban://`, which no _Avoid_ term matches.
- **Self-hosted upgrade moves the data by dump and restore.** Renaming the Compose project also renames the data volume, and Postgres only applies `POSTGRES_USER` and `POSTGRES_DB` on an empty volume. `pg_dump --no-owner --no-privileges` into the fresh `agentkanban` database avoids owner statements that name the old role.
