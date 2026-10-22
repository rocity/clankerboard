// Port and database name for the end-to-end run. Both default to values derived
// from this checkout's path, so two worktrees can run Playwright at the same time
// against the shared test Postgres without sharing a port or a database.
// Override with E2E_PORT and E2E_DB.
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const hash = createHash("sha256").update(root).digest();

export const e2ePort = Number(process.env.E2E_PORT ?? 4400 + (hash.readUInt16BE(0) % 500));
export const e2eDatabaseName = process.env.E2E_DB ?? `cb_e2e_${hash.toString("hex").slice(0, 8)}`;
