import {
  DomainError,
  getProject,
  listProjects,
  listTickets,
  notFound,
  type TicketView,
} from "@clankerboard/domain";
import { projectKey, statusLabels, ticketStatuses } from "@clankerboard/shared";
import {
  type McpServer,
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  ResourceTemplate,
} from "@modelcontextprotocol/server";
import { actorLabel } from "../markdown";
import type { ToolEnv } from "../tool";

export type BoardConfig = {
  /** How long a Done Ticket stays on the board after its last change. */
  doneWindowMs: number;
};

const day = 24 * 60 * 60 * 1000;
const pageSize = 200;
const uriOf = (key: string) => `clankerboard://projects/${key}/board`;

/**
 * `clankerboard://projects/{key}/board`: one Markdown section per Status, most
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
        "A project's tickets in Markdown, grouped by status and most urgent first, with ticket key, type, priority, title, and assignee. Archived tickets and old Done tickets are left out. Read it to see what is pending before you claim a ticket.",
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

async function boardMarkdown({ deps, ctx }: ToolEnv, config: BoardConfig, key: string) {
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

  const days = Math.round(config.doneWindowMs / day);
  const window = `${days === 1 ? "the last day" : `the last ${days} days`}`;
  const sections = ticketStatuses.map((status) => {
    const lines = tickets
      .filter((ticket) => ticket.status === status)
      .map((t) => {
        const assignee = t.assignee ? `assignee: ${actorLabel(t.assignee)}` : "unassigned";
        return `- **${t.key}** [${t.type}, ${t.priority}] ${t.title} (${assignee})`;
      });
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
