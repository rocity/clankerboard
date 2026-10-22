# Clankerboard Project

- Naming code, routes, tests or copy: use [GLOSSARY.md](./GLOSSARY.md) terms
- Decisions: [docs/adr/](./docs/adr/). Better Auth gotchas: [docs/better-auth.md](./docs/better-auth.md)
- Specs and tickets: `__private/Specs/`, `__private/Tickets/` (gitignored, local only). When a ticket and its spec disagree, stop and ask the user which is right
- Tests need the test database: `pnpm db:test:up`. Full check: `pnpm check`

## Guardrails
- Claude is allowed to commit in this repository
- Claude is NOT allowed to push to any remotes
- Commit message format: "feature: this is what i did in this commit, pikachu is not yellow"
  - Commit messages are once sentence only
  - The prefix is a Git Flow type: `feature`, `bugfix`, `hotfix`, `release`, or `support`
