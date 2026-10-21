import { describe, expect, it } from "vitest";
import { buildTestApp, createCompany, type SignedInUser, type TestApp, tokenFrom } from "./harness";

const smtp = { host: "smtp.example.com", port: 587, secure: false, from: "board@example.com" };
const day = 24 * 60 * 60 * 1000;

type Issued = {
  invite: { id: string; email: string; teamId: string | null; teamName: string | null };
  link: string;
  emailed: boolean;
};

async function teamInvite(
  user: SignedInUser,
  body: { email: string; teamId?: string; role?: string },
) {
  const res = await user.request("/api/invites", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { res, body: (await res.json()) as Issued };
}

function accept(user: SignedInUser, link: string) {
  return user.request("/api/invite-links/accept", {
    method: "POST",
    body: JSON.stringify({ token: tokenFrom(link) }),
  });
}

async function teamMemberEmails(user: SignedInUser, teamId: string) {
  const res = await user.request(`/api/teams/${teamId}`);
  return ((await res.json()) as { members: { email: string; role: string }[] }).members;
}

/** Acme with a Platform Team led by `lead`, a Mobile Team, and a plain member. */
async function setup(t: TestApp) {
  const { owner, members } = await createCompany(t, {
    name: "Acme",
    members: [
      { email: "lead@example.com", role: "member" },
      { email: "member@example.com", role: "member" },
    ],
  });
  const [lead, member] = members as [SignedInUser, SignedInUser];
  const create = async (name: string) => {
    const res = await owner.request("/api/teams", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return ((await res.json()) as { team: { id: string } }).team;
  };
  const platform = await create("Platform");
  const mobile = await create("Mobile");
  await owner.request(`/api/teams/${platform.id}/members`, {
    method: "POST",
    body: JSON.stringify({ userId: lead.user.id }),
  });
  await owner.request(`/api/teams/${platform.id}/members/${lead.user.id}`, {
    method: "PATCH",
    body: JSON.stringify({ role: "lead" }),
  });
  return { owner, lead, member, platform, mobile };
}

describe("Team Invites", () => {
  it("adds an existing Company member to the Team on acceptance", async () => {
    const t = buildTestApp();
    const { owner, member, platform } = await setup(t);

    const { res, body } = await teamInvite(owner, {
      email: member.user.email,
      teamId: platform.id,
    });
    expect(res.status).toBe(201);
    expect(body.invite).toMatchObject({ teamId: platform.id, teamName: "Platform" });

    expect((await accept(member, body.link)).status).toBe(200);
    expect(await teamMemberEmails(owner, platform.id)).toContainEqual(
      expect.objectContaining({ email: "member@example.com", role: "member" }),
    );
    const company = await (await member.request("/api/company")).json();
    expect(company).toMatchObject({ company: { role: "member" } });
  });

  it("keeps an existing member's Company Role when they join a Team", async () => {
    const t = buildTestApp();
    const { owner, platform } = await setup(t);
    const { body } = await teamInvite(owner, { email: owner.user.email, teamId: platform.id });

    await accept(owner, body.link);

    expect(await (await owner.request("/api/company")).json()).toMatchObject({
      company: { role: "owner" },
    });
  });

  it("brings a new email into both the Company and the Team", async () => {
    const t = buildTestApp({ config: { openSignup: false } });
    const { owner, platform } = await setup(t);
    const { body } = await teamInvite(owner, { email: "new@example.com", teamId: platform.id });

    const preview = await t.request("/api/invite-links/lookup", {
      method: "POST",
      body: JSON.stringify({ token: tokenFrom(body.link) }),
    });
    expect(await preview.json()).toMatchObject({
      invite: { companyName: "Acme", teamName: "Platform", email: "new@example.com" },
    });
    const newcomer = await t.signUp(
      { email: "new@example.com" },
      { headers: { "x-invite-token": tokenFrom(body.link) } },
    );
    expect((await accept(newcomer, body.link)).status).toBe(200);

    expect(await (await newcomer.request("/api/company")).json()).toMatchObject({
      company: { name: "Acme", role: "member" },
    });
    expect((await teamMemberEmails(owner, platform.id)).map((m) => m.email)).toContain(
      "new@example.com",
    );
  });

  it("lets a lead invite only to their own Team, and only as a member", async () => {
    const t = buildTestApp();
    const { lead, platform, mobile } = await setup(t);

    const own = await teamInvite(lead, { email: "a@example.com", teamId: platform.id });
    const other = await teamInvite(lead, { email: "b@example.com", teamId: mobile.id });
    const companyOnly = await teamInvite(lead, { email: "c@example.com" });
    const asAdmin = await teamInvite(lead, {
      email: "d@example.com",
      teamId: platform.id,
      role: "admin",
    });

    expect([own.res.status, other.res.status, companyOnly.res.status, asAdmin.res.status]).toEqual([
      201, 403, 403, 403,
    ]);
  });

  it("does not let a plain member invite to a Team", async () => {
    const t = buildTestApp();
    const { member, platform } = await setup(t);

    const { res } = await teamInvite(member, { email: "a@example.com", teamId: platform.id });

    expect(res.status).toBe(403);
  });

  it("shares the Company Invite lifecycle", async () => {
    const t = buildTestApp({ config: { smtp, inviteTtlMs: day } });
    const { owner, lead, platform } = await setup(t);

    const first = await teamInvite(lead, { email: "new@example.com", teamId: platform.id });
    expect(first.body.emailed).toBe(true);
    expect(t.mailer.sent.at(-1)?.text).toContain("invited you to join the Platform team at Acme.");

    // Resend by the lead kills the old link.
    const resent = await lead.request(`/api/invites/${first.body.invite.id}/resend`, {
      method: "POST",
    });
    const second = (await resent.json()) as Issued;
    expect(resent.status).toBe(200);
    const newcomer = await t.signUp({ email: "new@example.com" });
    expect((await accept(newcomer, first.body.link)).status).toBe(404);

    // Email must match.
    const mallory = await t.signUp({ email: "mallory@example.com" });
    expect((await accept(mallory, second.link)).status).toBe(403);

    // Expiry applies.
    t.clock.advance(2 * day);
    expect((await accept(newcomer, second.link)).status).toBe(410);

    // Revoke applies, and leads see their own Team's Invites.
    const third = await teamInvite(lead, { email: "other@example.com", teamId: platform.id });
    const listed = await (await lead.request("/api/invites")).json();
    expect(listed).toMatchObject({
      invites: expect.arrayContaining([expect.objectContaining({ id: third.body.invite.id })]),
    });
    const revoke = await lead.request(`/api/invites/${third.body.invite.id}/revoke`, {
      method: "POST",
    });
    expect(revoke.status).toBe(200);
    const late = await t.signUp({ email: "other@example.com" });
    expect((await accept(late, third.body.link)).status).toBe(410);
    expect(await teamMemberEmails(owner, platform.id)).toHaveLength(1);
  });

  it("shows a lead only their own Team's Invites and none of the Company's", async () => {
    const t = buildTestApp();
    const { owner, lead, platform, mobile } = await setup(t);
    await teamInvite(owner, { email: "company@example.com" });
    await teamInvite(owner, { email: "mobile@example.com", teamId: mobile.id });
    await teamInvite(owner, { email: "platform@example.com", teamId: platform.id });

    const res = await lead.request("/api/invites");

    expect(res.status).toBe(200);
    const { invites } = (await res.json()) as { invites: { email: string }[] };
    expect(invites.map((i) => i.email)).toEqual(["platform@example.com"]);
  });

  it("returns not-found for another Company's Team", async () => {
    const t = buildTestApp();
    const { platform } = await setup(t);
    const { owner: outsider } = await createCompany(t, { name: "Globex" });

    const { res } = await teamInvite(outsider, { email: "a@example.com", teamId: platform.id });

    expect(res.status).toBe(404);
  });

  it("refuses to invite someone already on the Team", async () => {
    const t = buildTestApp();
    const { owner, lead, platform } = await setup(t);

    const { res, body } = await teamInvite(owner, { email: lead.user.email, teamId: platform.id });

    expect(res.status).toBe(409);
    expect(body).toEqual({ error: "Already on this team." });
  });
});
