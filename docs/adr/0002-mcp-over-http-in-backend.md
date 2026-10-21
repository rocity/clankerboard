# MCP served over HTTP by the backend

The backend exposes the MCP server itself at `/mcp` (Streamable HTTP), authenticated with an Agent's API Key as a bearer token. The original plan was a local stdio script on each developer machine that called the REST API. We dropped it: a remote endpoint has nothing to install or keep version-synced, keeps all auth and Company scoping server-side, and Claude Code, Claude Desktop and VS Code all connect to HTTP MCP servers by URL. MCP tools call the same domain services as the REST routes in-process, not via HTTP round-trips.
