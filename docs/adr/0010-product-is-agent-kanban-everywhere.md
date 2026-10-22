# The product is Agent Kanban, in copy and in identifiers

The product is named **Agent Kanban** everywhere (Spec 08). Copy says "Agent Kanban". Identifiers say `agentkanban` in lowercase, `AGENTKANBAN_` for environment variables, and `AgentKanban` where PascalCase is idiomatic:

- MCP server name `agentkanban`, in the server's MCP implementation info, the setup command, the `.mcp.json` snippet, and the Agent prompt.
- `AGENTKANBAN_API_KEY`, the environment variable the `.mcp.json` snippet reads the API Key from.
- `agentkanban://projects/{key}/board`, the MCP board resource URI.
- Browser storage keys `agentkanban-theme` and `agentkanban-last-company`.
- The `@agentkanban/*` package scope and the root package name.
- The Docker Compose project, the database names, users and passwords, the CI workflow, and test MCP client names.

## History

The product began under the codename "Clankerboard". Spec 08 first renamed only the copy and kept every identifier on the codename (`clankerboard` MCP server, `CLANKERBOARD_API_KEY`, `clankerboard://` URIs, `clankerboard-theme` and `clankerboard-last-company` storage keys, the `@clankerboard/*` scope, and `clankerboard` database credentials), on the grounds that renaming them would break existing Agents and saved state. Before that version was released, the product owner reversed the decision: one name inside and out is worth a one-time break for existing setups.

## Hard break, no compatibility path

The rename has no fallback reads of the old storage keys, no alias for the old server name or URI, and no migration of database credentials. A compatibility path would keep the codename in the code indefinitely, which is the thing the rename removes, and the install base is small enough that a one-time manual upgrade costs less. The upgrade steps are in [docs/self-hosting.md](../self-hosting.md#upgrading-to-the-agent-kanban-names):

- Existing Agents must be re-registered under the new server name, and `.mcp.json` files and shell setups must use `AGENTKANBAN_API_KEY`.
- Each returning User's saved theme and last Company reset once.
- Self-hosted deployments must move their data to the new database name and credentials.

## Consequences

- New copy uses the `productName` constant from `@agentkanban/shared` (`packages/shared/src/product.ts`), never a literal. The static `<title>` in the web app's `index.html` can't import it and is the one place the name is duplicated.
- New identifiers use the `agentkanban` forms above.
- GLOSSARY.md lists the codename as the term to avoid, so `pnpm lint` (`scripts/check-copy.mjs`) flags it in multi-word copy. Apart from that entry and this ADR's history, the codename appears nowhere in the repository.
- A future rename is the constant, the HTML title, the glossary entry, the identifiers above, and the test expectations.
