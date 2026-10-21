import {
  createAgent,
  createApiKey,
  type DomainDeps,
  listAgents,
  listApiKeys,
  renameAgent,
  revokeAgent,
  revokeApiKey,
  whoami,
} from "@clankerboard/domain";
import { createAgentInput, createApiKeyInput, renameAgentInput } from "@clankerboard/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireCompany } from "../middleware/authenticate";
import { json } from "../validate";

export function agentRoutes(deps: DomainDeps) {
  return new Hono<AppEnv>()
    .get("/whoami", requireCompany(deps), async (c) => {
      return c.json(await whoami(deps, c.var.company));
    })
    .use("/agents", requireCompany(deps))
    .use("/agents/*", requireCompany(deps))
    .get("/agents", async (c) => {
      return c.json({ agents: await listAgents(deps, c.var.company) });
    })
    .post("/agents", json(createAgentInput), async (c) => {
      return c.json({ agent: await createAgent(deps, c.var.company, c.req.valid("json")) }, 201);
    })
    .patch("/agents/:agentId", json(renameAgentInput), async (c) => {
      const agent = await renameAgent(
        deps,
        c.var.company,
        c.req.param("agentId"),
        c.req.valid("json"),
      );
      return c.json({ agent });
    })
    .post("/agents/:agentId/revoke", async (c) => {
      return c.json({ agent: await revokeAgent(deps, c.var.company, c.req.param("agentId")) });
    })
    .get("/agents/:agentId/keys", async (c) => {
      return c.json({ keys: await listApiKeys(deps, c.var.company, c.req.param("agentId")) });
    })
    .post("/agents/:agentId/keys", json(createApiKeyInput), async (c) => {
      const created = await createApiKey(
        deps,
        c.var.company,
        c.req.param("agentId"),
        c.req.valid("json"),
      );
      return c.json(created, 201);
    })
    .post("/agents/:agentId/keys/:keyId/revoke", async (c) => {
      const key = await revokeApiKey(
        deps,
        c.var.company,
        c.req.param("agentId"),
        c.req.param("keyId"),
      );
      return c.json({ key });
    });
}
