import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createCompany,
  plainCopy,
  type SignedInUser,
  type TestApp,
  tokenFrom,
} from "./harness";

const smtp = { host: "smtp.example.com", port: 587, secure: false, from: "board@example.com" };
const day = 24 * 60 * 60 * 1000;

type InviteResponse = {
  invite: { id: string; email: string; role: string; status: string };
  link: string;
  emailed: boolean;
};

async function invite(user: SignedInUser, body: { email: string; role?: string }) {
  const res = await user.request("/api/invites", {
    method: "POST",
    body: JSON.stringify({ role: "member", ...body }),
  });
  return { res, body: (await res.json()) as InviteResponse };
}

function lookup(t: TestApp, link: string) {
  return t.request("/api/invite-links/lookup", {
    method: "POST",
    body: JSON.stringify({ token: tokenFrom(link) }),
  });
}

function accept(user: SignedInUser, link: string) {
  return user.request("/api/invite-links/accept", {
    method: "POST",
    body: JSON.stringify({ token: tokenFrom(link) }),
  });
}

function signUpWithInvite(t: TestApp, email: string, link: string) {
  return t.signUp({ email }, { headers: { "x-invite-token": tokenFrom(link) } });
}

describe("Company Invites", () => {
  it("returns a copyable link to the inviter and lists the Invite as pending", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });

    const { res, body } = await invite(owner, { email: "Bob@Example.com", role: "admin" });

    expect(res.status).toBe(201);
    expect(body.link).toMatch(/^http:\/\/localhost:3000\/invite#[A-Za-z0-9_-]{40,}$/);
    expect(body.invite).toMatchObject({
      email: "bob@example.com",
      role: "admin",
      status: "pending",
    });

    const list = await owner.request("/api/invites");
    const listed = await list.text();
    expect(JSON.parse(listed)).toMatchObject({
      invites: [{ id: body.invite.id, email: "bob@example.com", status: "pending" }],
    });
    expect(listed).not.toContain(tokenFrom(body.link));
  });

  it("emails the link only when SMTP is configured", async () => {
    const withSmtp = buildTestApp({ config: { smtp } });
    const without = buildTestApp();
    const a = await createCompany(withSmtp, { name: "Acme" });
    const b = await createCompany(without, { name: "Globex" });

    const sent = await invite(a.owner, { email: "bob@example.com" });
    const notSent = await invite(b.owner, { email: "cy@example.com" });

    expect(sent.body.emailed).toBe(true);
    expect(notSent.body.emailed).toBe(false);
    expect(without.mailer.sent).toEqual([]);
    expect(withSmtp.mailer.sent).toHaveLength(1);
    const mail = withSmtp.mailer.sent[0];
    expect(mail?.to).toBe("bob@example.com");
    expect(mail?.subject).toBe("Join Acme on Clankerboard");
    expect(mail?.text).toContain(sent.body.link);
    expect(plainCopy(`${mail?.subject} ${mail?.text}`)).toBe(true);
  });

  it("lets a new invitee sign up and join, even with open sign-up off", async () => {
    const t = buildTestApp({ config: { openSignup: false } });
    const { company, owner } = await createCompany(t, { name: "Acme" });
    const { body } = await invite(owner, { email: "bob@example.com", role: "admin" });

    const preview = await lookup(t, body.link);
    expect(await preview.json()).toMatchObject({
      invite: { companyName: "Acme", email: "bob@example.com", role: "admin" },
    });
    const bob = await signUpWithInvite(t, "bob@example.com", body.link);
    const res = await accept(bob, body.link);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ company: { id: company.id, role: "admin" } });
    expect(await (await bob.request("/api/company")).json()).toMatchObject({
      company: { name: "Acme", role: "admin" },
    });
    const pending = await owner.request("/api/invites");
    expect(await pending.json()).toEqual({ invites: [] });
  });

  it("does not let an Invite open sign-up for a different email", async () => {
    const t = buildTestApp({ config: { openSignup: false } });
    const { owner } = await createCompany(t, { name: "Acme" });
    const { body } = await invite(owner, { email: "bob@example.com" });

    await expect(signUpWithInvite(t, "mallory@example.com", body.link)).rejects.toThrow(/403/);
  });

  it("adds the Membership to an invitee who is already a User", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });
    const { owner: bob } = await createCompany(t, { name: "Bob's Shop" });
    const { body } = await invite(owner, { email: bob.user.email });

    const res = await accept(bob, body.link);

    expect(res.status).toBe(200);
    const companies = await (await bob.request("/api/companies")).json();
    expect(companies).toMatchObject({
      companies: [
        { name: "Acme", role: "member" },
        { name: "Bob's Shop", role: "owner" },
      ],
    });
  });

  it("only accepts for the User whose email was invited", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });
    const { body } = await invite(owner, { email: "bob@example.com" });
    const mallory = await t.signUp({ email: "mallory@example.com" });

    const res = await accept(mallory, body.link);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "This invite is for a different email address." });
    expect((await mallory.request("/api/companies").then((r) => r.json())) as object).toMatchObject(
      {
        companies: [],
      },
    );
  });

  it("requires a signed-in User to accept", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });
    const { body } = await invite(owner, { email: "bob@example.com" });

    const res = await t.request("/api/invite-links/accept", {
      method: "POST",
      body: JSON.stringify({ token: tokenFrom(body.link) }),
    });

    expect(res.status).toBe(401);
  });

  it("is single-use", async () => {
    const t = buildTestApp();
    const { owner } = await createCompany(t, { name: "Acme" });
    const { body } = await invite(owner, { email: "bob@example.com" });
    const bob = await t.signUp({ email: "bob@example.com" });
    await accept(bob, body.link);

    const again = await accept(bob, body.link);
    const preview = await lookup(t, body.link);

    expect(again.status).toBe(410);
    expect(await again.json()).toEqual({ error: "This invite was already used." });
    expect(preview.status).toBe(410);
  });

  it("issues a new link on resend and kills the old one", async () => {
    const t = buildTestApp({ config: { smtp } });
    const { owner } = await createCompany(t, { name: "Acme" });
    const first = await invite(owner, { email: "bob@example.com" });

    const res = await owner.request(`/api/invites/${first.body.invite.id}/resend`, {
      method: "POST",
    });
    const second = (await res.json()) as InviteResponse;

    expect(res.status).toBe(200);
    expect(second.link).not.toBe(first.body.link);
    expect(t.mailer.sent.map((m) => m.text.includes(second.link))).toEqual([false, true]);
    const old = await lookup(t, first.body.link);
    expect(old.status).toBe(404);
    expect(await old.json()).toEqual({ error: "This invite link is not valid." });
    const bob = await t.signUp({ email: "bob@example.com" });
    expect((await accept(bob, first.body.link)).status).toBe(404);
    expect((await accept(bob, second.link)).status).toBe(200);
  });

  it("refuses a revoked Invite", async () => {
    const t = buildTestApp({ config: { openSignup: false } });
    const { owner } = await createCompany(t, { name: "Acme" });
    const { body } = await invite(owner, { email: "bob@example.com" });

    const revoke = await owner.request(`/api/invites/${body.invite.id}/revoke`, { method: "POST" });

    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({ invite: { status: "revoked" } });
    const preview = await lookup(t, body.link);
    expect(preview.status).toBe(410);
    expect(await preview.json()).toEqual({ error: "This invite was revoked." });
    await expect(signUpWithInvite(t, "bob@example.com", body.link)).rejects.toThrow(/403/);
    expect(await (await owner.request("/api/invites")).json()).toEqual({ invites: [] });
  });

  it("refuses an expired Invite", async () => {
    const t = buildTestApp({ config: { openSignup: false, inviteTtlMs: 7 * day } });
    const { owner } = await createCompany(t, { name: "Acme" });
    const { body } = await invite(owner, { email: "bob@example.com" });

    t.clock.advance(7 * day - 1000);
    expect((await lookup(t, body.link)).status).toBe(200);

    t.clock.advance(2000);
    const preview = await lookup(t, body.link);
    expect(preview.status).toBe(410);
    expect(await preview.json()).toEqual({ error: "This invite has expired." });
    await expect(signUpWithInvite(t, "bob@example.com", body.link)).rejects.toThrow(/403/);
    expect(await (await owner.request("/api/invites")).json()).toMatchObject({
      invites: [{ status: "expired" }],
    });
  });

  it("revives an expired Invite on resend", async () => {
    const t = buildTestApp({ config: { inviteTtlMs: day } });
    const { owner } = await createCompany(t, { name: "Acme" });
    const { body } = await invite(owner, { email: "bob@example.com" });
    t.clock.advance(2 * day);

    const res = await owner.request(`/api/invites/${body.invite.id}/resend`, { method: "POST" });
    const { link } = (await res.json()) as InviteResponse;

    expect((await lookup(t, link)).status).toBe(200);
  });

  it.each([
    ["member", "member", 403],
    ["admin", "owner", 403],
    ["admin", "admin", 201],
    ["owner", "owner", 201],
  ] as const)("lets a %s invite as %s: %i", async (actorRole, role, status) => {
    const t = buildTestApp();
    const { members } = await createCompany(t, {
      name: "Acme",
      members: [{ email: "actor@example.com", role: actorRole }],
    });

    const { res } = await invite(members[0] as SignedInUser, { email: "new@example.com", role });

    expect(res.status).toBe(status);
  });

  it("lets only owners and admins see and manage Invites", async () => {
    const t = buildTestApp();
    const { owner, members } = await createCompany(t, {
      name: "Acme",
      members: [{ email: "bob@example.com", role: "member" }],
    });
    const bob = members[0] as SignedInUser;
    const { body } = await invite(owner, { email: "new@example.com" });

    expect((await bob.request("/api/invites")).status).toBe(403);
    const resend = await bob.request(`/api/invites/${body.invite.id}/resend`, { method: "POST" });
    expect(resend.status).toBe(403);
    const revoke = await bob.request(`/api/invites/${body.invite.id}/revoke`, { method: "POST" });
    expect(revoke.status).toBe(403);
  });

  it("returns not-found for another Company's Invite", async () => {
    const t = buildTestApp();
    const acme = await createCompany(t, { name: "Acme" });
    const globex = await createCompany(t, { name: "Globex" });
    const { body } = await invite(acme.owner, { email: "bob@example.com" });

    const resend = await globex.owner.request(`/api/invites/${body.invite.id}/resend`, {
      method: "POST",
    });
    const revoke = await globex.owner.request(`/api/invites/${body.invite.id}/revoke`, {
      method: "POST",
    });

    expect(resend.status).toBe(404);
    expect(revoke.status).toBe(404);
  });

  it("refuses to invite an existing member or double up a pending Invite", async () => {
    const t = buildTestApp();
    const { owner, members } = await createCompany(t, {
      name: "Acme",
      members: [{ email: "bob@example.com", role: "member" }],
    });
    await invite(owner, { email: "cy@example.com" });

    const member = await invite(owner, { email: (members[0] as SignedInUser).user.email });
    const duplicate = await invite(owner, { email: "CY@example.com" });

    expect(member.res.status).toBe(409);
    expect(member.body).toEqual({ error: "That user already belongs to this company." });
    expect(duplicate.res.status).toBe(409);
    expect(duplicate.body).toEqual({ error: "That email already has a pending invite." });
  });

  it("rejects an unknown link plainly", async () => {
    const t = buildTestApp();

    const res = await t.request("/api/invite-links/lookup", {
      method: "POST",
      body: JSON.stringify({ token: "not-a-real-token" }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "This invite link is not valid." });
  });
});
