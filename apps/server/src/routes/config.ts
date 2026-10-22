import { type DomainDeps, getPublicConfig } from "@agentkanban/domain";
import { Hono } from "hono";
import type { AppEnv } from "../env";

/**
 * Public: the few settings the web app needs before anyone signs in. The
 * public URL fills in the Agent setup snippets, and `signUpOpen` lets the
 * sign-up screen say up front when it needs an Invite.
 */
export function configRoutes(deps: DomainDeps) {
  return new Hono<AppEnv>().get("/config", async (c) => c.json(await getPublicConfig(deps)));
}
