# The product is Agent Kanban; identifiers keep the clankerboard codename

Every piece of text an end user reads names the product **Agent Kanban** (Spec 08). "Clankerboard" stays as the internal codename in identifiers. None of them is copy a person reads as a product name; each is a name other systems or saved state depend on, and renaming it would break something a User can't see the reason for. They stay on purpose and should not be "corrected":

- **MCP server name `clankerboard`**, in the server's MCP implementation info, the setup command, the `.mcp.json` snippet, and the Agent prompt. Existing `claude mcp add` registrations use it; renaming it would leave them pointing at a name the instructions no longer use and lead Users to register a second server. Clients that key on the server name would also stop recognising it.
- **`CLANKERBOARD_API_KEY`**, the environment variable in committed `.mcp.json` files and shell setups. Renaming it breaks every Agent configured with it.
- **`clankerboard://projects/{key}/board`**, the MCP board resource URI. Prompts and Agent habits built on it would stop resolving.
- **Browser storage keys** `clankerboard-theme` and `clankerboard-last-company`. Renaming them resets every returning User's theme (with a flash of the wrong one) and the Company they land in.
- **The `@clankerboard/*` package scope.** Internal to the monorepo; renaming it touches every import for no visible gain.
- **Docker and database names**: the Compose project name, database names, and credentials. Renaming them forces self-hosting operators to migrate or reconfigure a working deployment.
- **Test fixtures and test MCP client names**, including Projects named "Clankerboard". That is fixture data, not branding.

The Agent prompt therefore reads "the Agent Kanban Project ... through the "clankerboard" MCP server". The mix is accepted: the server name is an identifier the User types, and it must match what the Agents page tells them to register.

## Consequences

- New copy uses the `productName` constant from `@clankerboard/shared` (`packages/shared/src/product.ts`), never a literal. The static `<title>` in the web app's `index.html` can't import it and is the one place the name is duplicated.
- New identifiers may keep the codename for consistency with the ones above.
- GLOSSARY.md lists Clankerboard as the term to avoid, so `pnpm lint` (`scripts/check-copy.mjs`) flags it in multi-word copy. Identifier text that appears inside copy, such as the `clankerboard://` URI in the Agent prompt, is listed in `scripts/copy-allowlist.json`.
- A future rename is the constant, the HTML title, the glossary entry, and the test expectations.
