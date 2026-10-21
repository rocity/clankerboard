import {
  acceptInvite,
  createInvite,
  type DomainDeps,
  listInvites,
  previewInvite,
  resendInvite,
  revokeInvite,
} from "@clankerboard/domain";
import { createInviteInput, inviteTokenInput } from "@clankerboard/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireCompany, requireUser } from "../middleware/session";
import { json } from "../validate";

export function inviteRoutes(deps: DomainDeps) {
  return (
    new Hono<AppEnv>()
      .use("/invites", requireCompany(deps.db))
      .use("/invites/*", requireCompany(deps.db))
      .post("/invites", json(createInviteInput), async (c) => {
        return c.json(await createInvite(deps, c.var.company, c.req.valid("json")), 201);
      })
      .get("/invites", async (c) => {
        return c.json({ invites: await listInvites(deps, c.var.company) });
      })
      .post("/invites/:inviteId/resend", async (c) => {
        return c.json(await resendInvite(deps, c.var.company, c.req.param("inviteId")));
      })
      .post("/invites/:inviteId/revoke", async (c) => {
        return c.json({ invite: await revokeInvite(deps, c.var.company, c.req.param("inviteId")) });
      })
      // Link tokens travel in the body, never the URL, so they stay out of logs.
      .post("/invite-links/lookup", json(inviteTokenInput), async (c) => {
        return c.json({ invite: await previewInvite(deps, c.req.valid("json").token) });
      })
      .post("/invite-links/accept", requireUser, json(inviteTokenInput), async (c) => {
        return c.json({
          company: await acceptInvite(deps, c.var.actor, c.req.valid("json").token),
        });
      })
  );
}
