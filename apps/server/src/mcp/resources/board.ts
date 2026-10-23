import {
  DomainError,
  getProject,
  listProjects,
  listTickets,
  notFound,
  type TicketView,
} from "@agentkanban/domain";
import { projectKey, statusLabels, ticketStatuses } from "@agentkanban/shared";
import {
  type McpServer,
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  ResourceTemplate,
} from "@modelcontextprotocol/server";
import { ticketLine } from "../markdown";
import type { ToolEnv } from "../tool";
import { summarize, withEmails } from "../views";

export type BoardConfig = {
  /** How long a Done Ticket stays on the board after its last change. */
  doneWindowMs: number;
};

const day = 24 * 60 * 60 * 1000;
const pageSize = 200;
const uriOf = (key: string) => `agentkanban://projects/${key}/board`;

/**
 * `agentkanban://projects/{key}/board`: one Markdown section per Status, most
 * urgent first. Archived Tickets and Done Tickets past the window are left out.
 */
export function registerBoardResource(server: McpServer, env: ToolEnv, config: BoardConfig) {
  const { deps, ctx } = env;
  server.registerResource(
    "board",
    new ResourceTemplate(uriOf("{key}"), {
      list: async () => ({
        resources: (await listProjects(deps, ctx, {})).map((project) => ({
          uri: uriOf(project.key),
          name: `${project.key} board`,
          mimeType: "text/markdown",
        })),
      }),
    }),
    {
      mimeType: "text/markdown",
      description:
        "A project's tickets in Markdown, grouped by status and most urgent first, with ticket key, type, priority, title, and assignee, and blocked marked. Archived tickets and old Done tickets are left out. Read it to see what is pending before you claim a ticket.",
    },
    async (uri, { key }) => {
      try {
        const text = await boardMarkdown(env, config, String(key));
        return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
      } catch (error) {
        throw resourceError(error, uri.href, env);
      }
    },
  );
}

async function boardMarkdown(env: ToolEnv, config: BoardConfig, key: string) {
  const { deps, ctx } = env;
  const parsedKey = projectKey.safeParse(key);
  if (!parsedKey.success) throw notFound();
  const project = await getProject(deps, ctx, parsedKey.data);
  const doneSince = new Date(deps.clock.now().getTime() - config.doneWindowMs);

  const tickets: TicketView[] = [];
  let cursor: string | undefined;
  do {
    const page = await listTickets(
      deps,
      ctx,
      { projectKey: project.key, archived: "exclude", limit: pageSize, cursor },
      { order: "urgency", doneSince },
    );
    tickets.push(...page.tickets);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  const shown = (await withEmails(env, { tickets })).tickets;
  const days = Math.round(config.doneWindowMs / day);
  const window = `${days === 1 ? "the last day" : `the last ${days} days`}`;
  const sections = ticketStatuses.map((status) => {
    const lines = shown
      .filter((ticket) => ticket.status === status)
      .map((ticket) => `- ${ticketLine(summarize(ticket), { status: false })}`);
    const note = status === "done" ? `Changed in ${window}.` : null;
    const empty = status === "done" ? `No tickets changed in ${window}.` : "No tickets.";
    const body = lines.length === 0 ? empty : [note, lines.join("\n")].filter(Boolean).join("\n\n");
    return `## ${statusLabels[status]}\n\n${body}`;
  });
  return [`# ${project.key} board: ${project.name}`, ...sections].join("\n\n");
}

/**
 * Resource reads are not tool calls, so failures are protocol errors. Not
 * found keeps the domain's wording. Anything unexpected is logged and hidden.
 */
function resourceError(error: unknown, uri: string, { log }: ToolEnv) {
  if (error instanceof DomainError) {
    if (error.kind === "not_found") return new ResourceNotFoundError(uri, error.message);
    return new ProtocolError(ProtocolErrorCode.InvalidParams, error.message);
  }
  log.error({ err: error }, "unhandled MCP resource error");
  return new ProtocolError(ProtocolErrorCode.InternalError, "Something went wrong.");
}
