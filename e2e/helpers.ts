import { expect, type Locator, type Page } from "@playwright/test";

export const password = "correct-horse-battery";

/** Signs up through the sign-up screen and waits until the app has left it. */
export async function signUp(page: Page, name: string, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).not.toHaveURL(/\/sign-up/);
}

export async function signIn(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

type CompanyRow = { id: string; name: string; slug: string; role: string };

/** Creates a Company as the signed-in User. It becomes their session's active Company. */
export async function createCompany(page: Page, name: string) {
  const res = await page.request.post("/api/companies", { data: { name } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { company: CompanyRow }).company;
}

export async function companies(page: Page) {
  const res = await page.request.get("/api/companies");
  return (await res.json()) as { companies: CompanyRow[]; activeCompanyId: string | null };
}

/** True when the page scrolls sideways, which breaks the mobile layout. */
export function scrollsSideways(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

/** The box of an element once its animations have finished, so a dialog's zoom-in is not measured. */
export async function settledBox(locator: Locator) {
  await locator.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const dialog = locator.page().getByRole("dialog");
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return locator.boundingBox();
}

async function post<T>(page: Page, path: string, data: object, status = 201): Promise<T> {
  const res = await page.request.post(path, { data });
  expect(res.status(), `${path}: ${await res.text()}`).toBe(status);
  return (await res.json()) as T;
}

export type TicketRow = {
  key: string;
  title: string;
  status: string;
  rank: string;
  assignee: { type: string; id: string; name: string } | null;
};

/** Creates a Team in the active Company. */
export async function createTeam(page: Page, name: string) {
  return (await post<{ team: { id: string; name: string } }>(page, "/api/teams", { name })).team;
}

/** Creates a Project in the active Company. */
export async function createProject(
  page: Page,
  input: { name: string; key: string; teamId?: string },
) {
  return (await post<{ project: { id: string; key: string } }>(page, "/api/projects", input))
    .project;
}

/** Creates a Ticket. It lands at the bottom of Backlog. */
export async function createTicket(
  page: Page,
  input: { projectKey: string; title: string; type?: string } & Record<string, unknown>,
) {
  const body = { type: "task", ...input };
  return (await post<{ ticket: TicketRow }>(page, "/api/tickets", body)).ticket;
}

/** Moves a Ticket to a Status and, optionally, a zero-based position in it. */
export async function moveTicket(page: Page, key: string, status: string, position?: number) {
  const body = { status, position };
  return (await post<{ ticket: TicketRow }>(page, `/api/tickets/${key}/move`, body, 200)).ticket;
}

export async function createAgent(page: Page, name: string) {
  return (await post<{ agent: { id: string; name: string } }>(page, "/api/agents", { name })).agent;
}

export async function assignTicket(
  page: Page,
  key: string,
  assignee: { type: "user" | "agent"; id: string } | null,
) {
  const body = { assignee };
  return (await post<{ ticket: TicketRow }>(page, `/api/tickets/${key}/assign`, body, 200)).ticket;
}

/** The Tickets of a Project in the server's own board order. */
export async function listTickets(page: Page, projectKey: string) {
  const res = await page.request.get(`/api/tickets?projectKey=${projectKey}&limit=200`);
  return ((await res.json()) as { tickets: TicketRow[] }).tickets;
}
