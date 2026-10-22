# Spec 08 implementation notes

Deliberate choices made while implementing Spec 08 (Rebrand to Agent Kanban). Reviewers: treat these as decided unless one contradicts the spec or an ADR.

## 08-01 Product name in copy

- **One constant.** `productName` ("Agent Kanban") lives in `packages/shared/src/product.ts` and is exported from `@clankerboard/shared`. Brand, the header home link's `aria-label`, the Agent prompt, the invite email subject, and the default email sender read it. Tests assert the literal "Agent Kanban", not the constant, so a test can't pass by construction.
- **The HTML title is the one duplicated place.** `apps/web/index.html` is static and can't import the constant, so `<title>Agent Kanban</title>` is set by hand with a comment pointing at `product.ts`. A rename edits both, plus the glossary and the test expectations.
- **Mixed naming in the Agent prompt is accepted.** The opening line reads "the Agent Kanban project ... through the "clankerboard" MCP server". The server name is an identifier the User types in `claude mcp add`, and it must match what the Agents page tells them to register.
- **Strings left as "clankerboard", and why.** None is copy a User reads as a product name; each is something other systems or saved state depend on.
  - MCP server name `clankerboard` (server implementation info in `apps/server/src/mcp`, `serverName` in `apps/web/src/lib/agent-setup.ts`): renaming it would orphan existing `claude mcp add` registrations and lead Users to register a second server. Guarded by the MCP test on the server name and the `claude mcp add ... clankerboard ...` assertions in `e2e/board.spec.ts` and `e2e/agents.spec.ts`.
  - `CLANKERBOARD_API_KEY` (`keyEnvVar`): committed `.mcp.json` files and shell setups read it. Guarded by `e2e/agents.spec.ts`.
  - `clankerboard://projects/{key}/board` resource URI: prompts and Agent habits use it. Guarded by the MCP board resource tests.
  - Storage keys `clankerboard-theme` and `clankerboard-last-company`: renaming them would reset every returning User's theme and last Company. Guarded by `e2e/theme.spec.ts`.
  - The `@clankerboard/*` package scope, the Docker Compose project name, database names and credentials, and test client names: internal, and an operator's deployment depends on some of them.
  - Test fixtures naming a Project "Clankerboard" (`projects.test.ts`, `mcp-*.test.ts`) and the fixture HTML in `web-shell.test.ts`: fixture data, not branding.
- **Config test is the only new test file.** `apps/server/test/config.test.ts` calls `loadConfig` directly with a plain env object. It needs no database, though Vitest's global setup still starts the test harness for the whole run.
- **E2E coverage extends existing specs.** `e2e/auth.spec.ts` checks the tab title, the sign-in wordmark, and the header home link by its accessible name (on both the desktop wordmark and the phone icon-only header). `e2e/board.spec.ts` checks the prompt's opening line.
- **Pre-existing failing viewport check.** `board.spec.ts` "fits the viewport ... all show on a desktop" fails on `desktop-light` (Done lane in view at ratio 0.96, not 1). It fails the same way on the base commit without these changes, so it is not caused by the rename and is left alone here.
