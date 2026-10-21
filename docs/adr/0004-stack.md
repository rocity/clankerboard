# Stack: Hono + React SPA, Postgres, Drizzle

TypeScript end-to-end in a pnpm monorepo. The backend is a Hono server that serves the REST API, `/mcp`, the SSE stream and the built frontend's static files from a single Node process. The frontend is a Vite + React SPA. Data lives in Postgres, accessed through Drizzle with drizzle-kit migrations.

REST routes and MCP tools are thin adapters over one in-process domain service layer (`packages/domain`), which owns validation, hierarchy rules, permission checks and Activity writes, so the two surfaces cannot drift. The web app gets end-to-end types from Hono's RPC client (`hc`).

## Considered Options

- **Next.js full-stack**: rejected. The API is the primary surface (agents use it as much as humans do), a board is all client interaction after login so SSR buys little, and RSC/caching semantics add friction to long-lived SSE and MCP connections.
- **FastAPI / Python**: rejected. A second language with no Python-only need. TS lets the REST validators and MCP tool schemas share one set of zod definitions.
- **SQLite**: rejected. Many agents write at once, and Postgres LISTEN/NOTIFY gives a path to multi-process realtime fan-out.
- **tRPC / GraphQL**: rejected. Hono RPC gives the same type safety while the API stays plain REST, callable from curl, scripts and CI.
- **Prisma**: rejected in favour of Drizzle. Drizzle has no codegen or engine binary, its SQL-shaped queries make Company scoping explicit, and it is Better Auth's first-class adapter.
