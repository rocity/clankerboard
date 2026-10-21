import {
  createCompany,
  type DomainDeps,
  getCompany,
  listCompanies,
  switchCompany,
  updateCompany,
} from "@clankerboard/domain";
import { createCompanyInput, switchCompanyInput, updateCompanyInput } from "@clankerboard/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireCompany, requireUser } from "../middleware/session";
import { json } from "../validate";

export function companyRoutes(deps: DomainDeps) {
  return new Hono<AppEnv>()
    .get("/companies", requireUser, async (c) => {
      const companies = await listCompanies(deps, c.var.actor);
      const active = companies.find((co) => co.id === c.var.session?.activeOrganizationId);
      return c.json({ companies, activeCompanyId: active?.id ?? null });
    })
    .post("/companies", requireUser, json(createCompanyInput), async (c) => {
      const company = await createCompany(deps, c.var.actor, c.req.valid("json"));
      return c.json({ company }, 201);
    })
    .put("/active-company", requireUser, json(switchCompanyInput), async (c) => {
      const company = await switchCompany(deps, c.var.actor, c.req.valid("json").companyId);
      return c.json({ company });
    })
    .get("/company", requireCompany(deps.db), async (c) => {
      return c.json({ company: await getCompany(deps, c.var.company) });
    })
    .patch("/company", requireCompany(deps.db), json(updateCompanyInput), async (c) => {
      return c.json({ company: await updateCompany(deps, c.var.company, c.req.valid("json")) });
    });
}
