import type { CompanyContext, DomainDeps } from "@clankerboard/domain";
import { type AuthInfo, createMcpHandler } from "@modelcontextprotocol/server";
import { Hono, type MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import type { Logger } from "../logger";
import { createMcpServer } from "./server";

/** What the route hands the SDK, which passes it to the server factory untouched. */
type McpCaller = { company: CompanyContext; log: Logger };

/**
 * `/mcp`, served statelessly: every request carries its own API Key and gets a
 * fresh MCP server acting as that Agent (ADR-0002). Both the 2026-07-28
 * revision and the 2025 handshake are served. Session cookies are never read.
 */
export function mcpRoutes(deps: DomainDeps, authenticate: MiddlewareHandler<AppEnv>) {
  const handler = createMcpHandler(({ authInfo }) => {
    const caller = authInfo?.extra?.caller as McpCaller | undefined;
    if (!caller) throw new Error("MCP request reached the server without an authenticated Agent");
    return createMcpServer({ deps, ctx: caller.company, log: caller.log });
  });

  return new Hono<AppEnv>().all("/mcp", requireBearer, authenticate, async (c) => {
    const agent = c.var.agent;
    if (!agent) return c.json({ error: missingKey }, 401);
    const caller: McpCaller = { company: agent.ctx, log: c.var.log };
    const authInfo: AuthInfo = {
      // The SDK only passes this through. It holds the key's id, never its secret.
      token: agent.keyId,
      clientId: agent.agent.id,
      scopes: [],
      extra: { caller },
    };
    return handler.fetch(c.req.raw, { authInfo });
  });
}

const missingKey = "Send an API key in the Authorization header.";

/** Without this, a request with no key would fall through to the session cookie. */
const requireBearer = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.header("authorization") === undefined) return c.json({ error: missingKey }, 401);
  await next();
});
