import { companyRoles } from "@clankerboard/shared";
import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createCompany,
  createProject,
  createTicket,
  type Fetch,
  openStream,
  type SignedInUser,
  type TestApp,
} from "./harness";

/** A User with `role` in a fresh Company, which has Project CB. */
async function userWithRole(t: TestApp, company: string, role: (typeof companyRoles)[number]) {
  const { owner, members } = await createCompany(t, {
    name: company,
    members: role === "owner" ? [] : [{ email: `${role}@${company}.example.com`, role }],
  });
  return { owner, user: members[0] ?? owner };
}

/** What `as` can read of Project CB and Ticket CB-1 through REST. */
async function restView(as: Fetch) {
  const project = await as("/api/projects/CB");
  const ticket = await as("/api/tickets/CB-1");
  const projects = (await (await as("/api/projects")).json()) as { projects: { key: string }[] };
  const tickets = (await (await as("/api/tickets")).json()) as { tickets: { key: string }[] };
  return {
    project: project.status,
    ticket: ticket.status,
    listedProjects: projects.projects.map((p) => p.key),
    listedTickets: tickets.tickets.map((t) => t.key),
  };
}

/** Creates Project CB with Ticket CB-1 and renames the Project, as `owner`. */
async function changeTheBoard(owner: SignedInUser) {
  await createProject(owner.request, { name: "Board", key: "CB" });
  await createTicket(owner.request, { projectKey: "CB", title: "Login breaks" });
  await owner.request("/api/projects/CB", {
    method: "PATCH",
    body: JSON.stringify({ name: "Main board" }),
  });
}

describe("Project visibility, through REST and the live stream alike", () => {
  it.each(companyRoles)("lets a %s see every Project and Ticket in the Company", async (role) => {
    const t = buildTestApp();
    const { owner, user } = await userWithRole(t, "acme", role);
    const tab = await openStream(user.request);

    await changeTheBoard(owner);
    const events = [await tab.nextEvent(), await tab.nextEvent(), await tab.nextEvent()];
    await tab.close();

    expect(await restView(user.request)).toEqual({
      project: 200,
      ticket: 200,
      listedProjects: ["CB"],
      listedTickets: ["CB-1"],
    });
    expect(events.map((event) => event.event)).toEqual([
      "project.created",
      "ticket.created",
      "project.updated",
    ]);
  });

  it.each(companyRoles)("shows a %s of another Company none of it", async (role) => {
    const t = buildTestApp();
    const acme = await createCompany(t, { name: "Acme" });
    const { owner: globexOwner, user } = await userWithRole(t, "globex", role);
    await createProject(globexOwner.request, { name: "Globex board", key: "GX" });
    const tab = await openStream(user.request);

    await changeTheBoard(acme.owner);
    // A keepalive queues behind every event already published, so reaching
    // it next means no Acme event was coming.
    t.clock.advance(20_000);
    const messages = [await tab.next(), await tab.next()];
    await tab.close();

    expect(await restView(user.request)).toEqual({
      project: 404,
      ticket: 404,
      listedProjects: ["GX"],
      listedTickets: [],
    });
    expect(messages).toEqual([{ retry: 3000 }, { comment: "keepalive" }]);
  });
});
