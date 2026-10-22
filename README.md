# Agent Kanban

A self-hosted task board where humans and AI agents work side by side on the same Tickets. Agents read and change the board through MCP. Humans watch and steer through the web UI.

This README is for people working on the code. Operators running an instance should start with [docs/self-hosting.md](docs/self-hosting.md) and the settings listed in [docker-compose.yml](docker-compose.yml).

## Stack

Node (TypeScript), Hono, Postgres with Drizzle, Better Auth, and a React SPA built with Vite, TanStack Router and Query, and Tailwind v4 with shadcn. Tests run on Vitest and Playwright, linting on Biome. The reasoning is in [ADR-0004](docs/adr/0004-stack.md).

The app ships as one container plus Postgres ([ADR-0001](docs/adr/0001-self-hosted-single-deployable.md)). The server also serves the built web app and the MCP endpoint at `/mcp` ([ADR-0002](docs/adr/0002-mcp-over-http-in-backend.md)).

## Layout

pnpm workspace.

| Path | What lives there |
| --- | --- |
| `apps/server` | Hono app: REST routes (`src/routes`), MCP server (`src/mcp`), live stream (`src/realtime`), Better Auth setup, config. |
| `apps/web` | React SPA. Talks to the server through a typed `hc` client. |
| `packages/domain` | The rules: permissions, Actor rules, Ticket, Invite and Activity services. Routes and MCP tools both call it. |
| `packages/db` | Drizzle schema, migrations (`drizzle/`), and the database client. |
| `packages/shared` | Types and zod schemas shared by server and web, such as the Role permission matrix. |
| `e2e` | Playwright specs. |
| `docs` | ADRs, Better Auth notes, self-hosting notes, and per-spec implementation notes. |

A route is a thin adapter: parse input, call one domain service, shape the response. Put new rules in `packages/domain`, not in a route or an MCP tool.

## Prerequisites

- Node 22.18 or newer (`.nvmrc` pins 24)
- pnpm 10.8 (via `corepack enable`)
- Docker, for Postgres

## Getting started

```sh
pnpm install
```

`pnpm install` also installs the git hooks (see [Commits](#commits)).

The server needs a Postgres. The throwaway `db-test` container from the compose file works for development. It keeps its data in memory, so it forgets everything when it stops.

```sh
cp .env.local.example .env.local
pnpm db:test:up
pnpm dev
```

In a second terminal, start the web app:

```sh
pnpm --filter @agentkanban/web dev
```

Open <http://localhost:4311>. The first User to sign up is allowed in. Anyone else needs an Invite unless `OPEN_SIGNUP=true`. Without `SMTP_HOST` no email is sent, so copy Invite links from the UI.

`.env.local` is git-ignored. `pnpm dev` loads it for the server, and the web dev server reads its ports from it. Outside `pnpm dev` the server reads settings from the environment only and does not load env files itself. Docker Compose reads `.env`, not `.env.local`, so the two don't affect each other.

### Ports

The defaults avoid the ports other projects commonly hold (3000, 5173, 5432, 8080).

| Port | Used by | Set with |
| --- | --- | --- |
| 4310 | API server under `pnpm dev` | `PORT` in `.env.local` |
| 4311 | Vite dev server, the address you open | `WEB_PORT` in `.env.local` |
| 55432 | `db-test` Postgres, for dev, Vitest and Playwright | `docker-compose.yml`, `TEST_DATABASE_URL` |
| 4400 to 4899 | Playwright's server, picked per checkout from its path | `E2E_PORT` |
| 3000 | Docker Compose app | `PORT` in `.env` |

The Vite dev server proxies `/api` to `PORT` and refuses to start if `WEB_PORT` is taken. `BASE_URL` in `.env.local` must match the address in your browser (`http://localhost:4311` by default), or Better Auth rejects sign-in with `INVALID_ORIGIN`. If you change `WEB_PORT`, change `BASE_URL` to match.

Check what holds a port with `lsof -nP -iTCP:4310 -sTCP:LISTEN`.

### Configuration

Every setting, its default, and what it does is in [docker-compose.yml](docker-compose.yml). The server reads them in [apps/server/src/config.ts](apps/server/src/config.ts). Only `DATABASE_URL` is required. Put local overrides in `.env.local`; `.env.local.example` lists the common ones.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Server with reload (`tsx watch`). |
| `pnpm build` | Build the web app, then bundle the server. |
| `pnpm lint` | Biome, plus `scripts/check-copy.mjs` for user-facing copy. |
| `pnpm format` | Biome format, write. |
| `pnpm typecheck` | `tsc` in every package. |
| `pnpm test` | Vitest. Needs the test database. |
| `pnpm test:e2e` | Playwright. Builds the app first. Needs the test database. |
| `pnpm check` | Lint, typecheck, and unit tests. The pre-commit hook and CI both run it. |
| `pnpm db:generate` | Generate a Drizzle migration from `packages/db/src/schema.ts`. |
| `pnpm db:test:up` | Start the test Postgres. |

## Testing

Start the test database first:

```sh
pnpm db:test:up
```

Vitest migrates one template database per run and gives each test file its own copy, so files run in parallel. The default connection is `postgres://agentkanban:agentkanban@localhost:55432/postgres`. Override it with `TEST_DATABASE_URL`.

Server tests go through the HTTP seam with [apps/server/test/harness.ts](apps/server/test/harness.ts) and check effects through later requests, never by reading tables. Run with `CB_TEST_LOG=debug` to see server logs.

Playwright runs each spec twice, desktop light and phone-sized dark. Each checkout gets its own port (4400 to 4899) and database name derived from its path, so several worktrees can run e2e at once. Override them with `E2E_PORT` and `E2E_DB`.

CI ([.github/workflows/check.yml](.github/workflows/check.yml)) runs lint, typecheck, Vitest, and Playwright.

## Database changes

1. Edit `packages/db/src/schema.ts`.
2. Run `pnpm db:generate` and commit the new files in `packages/db/drizzle/`.

Migrations run on server start. Several tables belong to Better Auth. Read [docs/better-auth.md](docs/better-auth.md) before touching them or `apps/server/src/auth.ts`.

## Conventions

- **Names:** use the terms in [GLOSSARY.md](GLOSSARY.md) for code, routes, tests, and copy. Do not use the terms marked _Avoid_.
- **Review rules:** [CODING_STANDARDS.md](CODING_STANDARDS.md) lists what a reviewer checks on each diff.
- **Decisions:** [docs/adr/](docs/adr/). Add an ADR for a choice that is hard to reverse.
- **User-facing copy:** no em dashes, no emojis, say it once. `pnpm lint` checks this.
- **Specs:** when you implement one, record each deliberate choice a reviewer might question in `docs/implementation-notes/spec-NN.md`.

### Commits

The `commit-msg` hook enforces one sentence in this shape:

```
feature: what changed, pikachu is not yellow
```

The prefix is a Git Flow type: `feature`, `bugfix`, `hotfix`, `release`, or `support`. The `pre-commit` hook runs `pnpm check`, so start the test database before you commit.

## Docker

```sh
docker compose up --build
```

This starts the app on port 3000 with its own Postgres volume. If another project holds 3000, put `PORT=<free port>` and a matching `BASE_URL` in `.env`. The image bundles the server into one file and carries the built web app and migrations. Health check: `GET /healthz`.

## License

MIT. See [LICENSE](LICENSE).
