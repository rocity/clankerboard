import { describe, expect, it } from "vitest";
import { buildTestApp, createCompany, type SignedInUser } from "./harness";

type Company = { id: string; name: string; slug: string; role: string };

describe("Companies", () => {
  it("makes the creator the owner of a new Company", async () => {
    const t = buildTestApp();
    const alice = await t.signUp({ email: "alice@example.com" });

    const res = await alice.request("/api/companies", {
      method: "POST",
      body: JSON.stringify({ name: "Acme Robotics" }),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      company: { name: "Acme Robotics", slug: "acme-robotics", role: "owner" },
    });
    const active = await alice.request("/api/company");
    expect(await active.json()).toMatchObject({
      company: { name: "Acme Robotics", role: "owner" },
    });
  });

  it("lists the User's Companies and switches the active one", async () => {
    const t = buildTestApp();
    const alice = await t.signUp({ email: "alice@example.com" });
    const create = async (name: string) => {
      const res = await alice.request("/api/companies", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      return ((await res.json()) as { company: Company }).company;
    };
    const acme = await create("Acme");
    const globex = await create("Globex");

    const list = await alice.request("/api/companies");
    expect(await list.json()).toEqual({
      companies: [
        expect.objectContaining({ id: acme.id, name: "Acme", role: "owner" }),
        expect.objectContaining({ id: globex.id, name: "Globex", role: "owner" }),
      ],
      activeCompanyId: globex.id,
    });

    const switched = await alice.request("/api/active-company", {
      method: "PUT",
      body: JSON.stringify({ companyId: acme.id }),
    });
    expect(switched.status).toBe(200);
    const active = await alice.request("/api/company");
    expect(await active.json()).toMatchObject({ company: { id: acme.id, name: "Acme" } });
  });

  it.each([
    ["owner", 200],
    ["admin", 200],
    ["member", 403],
  ] as const)("lets a %s rename the Company and change its slug: %i", async (role, status) => {
    const t = buildTestApp();
    const { members } = await createCompany(t, {
      name: "Acme",
      members: [{ email: "someone@example.com", role }],
    });
    const someone = members[0] as SignedInUser;

    const res = await someone.request("/api/company", {
      method: "PATCH",
      body: JSON.stringify({ name: "Acme Inc", slug: "acme-inc" }),
    });

    expect(res.status).toBe(status);
    const after = (await (await someone.request("/api/company")).json()) as { company: Company };
    if (status === 200) expect(after.company).toMatchObject({ name: "Acme Inc", slug: "acme-inc" });
    else expect(after.company).toMatchObject({ name: "Acme", slug: "acme" });
  });

  it("keeps slugs unique", async () => {
    const t = buildTestApp();
    await createCompany(t, { name: "Acme", slug: "acme" });
    const { owner } = await createCompany(t, { name: "Globex", slug: "globex" });

    const taken = await owner.request("/api/company", {
      method: "PATCH",
      body: JSON.stringify({ slug: "acme" }),
    });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "That slug is taken." });

    const createTaken = await owner.request("/api/companies", {
      method: "POST",
      body: JSON.stringify({ name: "Another", slug: "acme" }),
    });
    expect(createTaken.status).toBe(409);
  });

  it("gives a fresh slug when a derived one is taken", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });

    const res = await owner.request("/api/companies", {
      method: "POST",
      body: JSON.stringify({ name: "Acme" }),
    });

    expect(res.status).toBe(201);
    const { company } = (await res.json()) as { company: Company };
    expect(company.slug).toMatch(/^acme-[a-z0-9]+$/);
  });

  it("rejects an invalid slug with a plain message", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });

    const res = await owner.request("/api/company", {
      method: "PATCH",
      body: JSON.stringify({ slug: "Not A Slug!" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Slugs use lowercase letters, numbers, and single dashes.",
    });
  });

  it("returns not-found for a Company the User does not belong to", async () => {
    const t = buildTestApp();
    const { company: acme } = await createCompany(t, { name: "Acme" });
    const { owner: bob } = await createCompany(t, { name: "Globex" });

    const res = await bob.request("/api/active-company", {
      method: "PUT",
      body: JSON.stringify({ companyId: acme.id }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found." });
    const active = await bob.request("/api/company");
    expect(await active.json()).toMatchObject({ company: { name: "Globex" } });
  });

  it("asks a User with no active Company to pick one", async () => {
    const t = buildTestApp();
    const alice = await t.signUp({ email: "alice@example.com" });

    const res = await alice.request("/api/company");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Pick a company first." });
  });

  it("does not expose Better Auth's own organization endpoints", async () => {
    const t = buildTestApp();
    const alice = await t.signUp({ email: "alice@example.com" });

    const res = await alice.request("/api/auth/organization/create", {
      method: "POST",
      body: JSON.stringify({ name: "Sneaky", slug: "sneaky" }),
    });

    expect(res.status).toBe(404);
  });
});
