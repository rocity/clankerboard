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
import { requireCompany, requireUser, signedIn } from "../middleware/authenticate";
import { json } from "../validate";

export function companyRoutes(deps: DomainDeps) {
  return new Hono<AppEnv>()
    .get("/companies", requireUser, async (c) => {
      return c.json(await listCompanies(deps, signedIn(c), c.var.activeCompanyId));
    })
    .post("/companies", requireUser, json(createCompanyInput), async (c) => {
      const company = await createCompany(deps, signedIn(c), c.req.valid("json"));
      return c.json({ company }, 201);
    })
    .put("/active-company", requireUser, json(switchCompanyInput), async (c) => {
      const company = await switchCompany(deps, signedIn(c), c.req.valid("json").companyId);
      return c.json({ company });
    })
    .get("/company", requireCompany(deps), async (c) => {
      return c.json({ company: await getCompany(deps, c.var.company) });
    })
    .patch("/company", requireCompany(deps), json(updateCompanyInput), async (c) => {
      return c.json({ company: await updateCompany(deps, c.var.company, c.req.valid("json")) });
    });
}
