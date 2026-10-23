import { productName } from "@agentkanban/shared";

/** The environment variable the `.mcp.json` snippet reads the key from. */
export const keyEnvVar = "AGENTKANBAN_API_KEY";

const serverName = "agentkanban";

/** The MCP endpoint of this server, from the public URL the operator configured. */
export function mcpUrl(publicUrl: string) {
  return `${publicUrl.replace(/\/+$/, "")}/mcp`;
}

/**
 * The command that registers this server in Claude Code, with the key filled in.
 * User scope makes it load in every session on the machine. Claude Code's
 * default, local scope, ties it to the folder the command ran in, so sessions
 * opened anywhere else don't have the tools.
 */
export function addCommand(publicUrl: string, apiKey: string) {
  return `claude mcp add --scope user --transport http ${serverName} ${mcpUrl(publicUrl)} --header "Authorization: Bearer ${apiKey}"`;
}

/** A `.mcp.json` that reads the key from the environment, so the file is safe to commit. */
export function mcpJson(publicUrl: string) {
  return JSON.stringify(
    {
      mcpServers: {
        [serverName]: {
          type: "http",
          url: mcpUrl(publicUrl),
          headers: { Authorization: `Bearer \${${keyEnvVar}}` },
        },
      },
    },
    null,
    2,
  );
}

export function exportLine(apiKey: string) {
  return `export ${keyEnvVar}=${apiKey}`;
}

type AgentPromptInput = {
  publicUrl: string;
  companySlug: string;
  projectKey: string;
  projectName: string;
};

/**
 * What a User pastes into Claude Code so it connects to this server and works a
 * Project's Tickets. It holds no API Key: Claude asks for one when the MCP tools
 * are missing, so the prompt can be copied again and shared. The tool names and
 * their arguments must match apps/server/src/mcp/tools.
 */
export function agentPrompt({ publicUrl, companySlug, projectKey, projectName }: AgentPromptInput) {
  const base = publicUrl.replace(/\/+$/, "");
  return `You will work on Tickets in the ${productName} Project "${projectName}" (Project Key ${projectKey}) through the "${serverName}" MCP server. The humans you work with watch the board live at ${base}/${companySlug}/projects/${projectKey}.

## 1. Connect
Check that the ${serverName} MCP tools (list_tickets, get_ticket, claim_ticket, and the rest) are available. If they are not:
1. Ask me for an API Key. I create one for an Agent at ${base}/${companySlug}/agents.
2. Run this command with the key in place of <API key>. It registers the server once for every Claude Code session on this machine, whatever folder it opens in. Never write the key into a file in this repository.
   ${addCommand(base, "<API key>")}
3. Ask me to restart Claude Code so the tools load, then go on with step 2.

## 2. The board
- Every Ticket has a Ticket Key such as ${projectKey}-12, a type (epic, story, task, bug), a priority, and a status: backlog, todo, in_progress, review, done.
- You act as your own Agent. Every change you make is credited to you and shows up live on the board.
- The resource agentkanban://projects/${projectKey}/board lists every status at a glance.

## 3. Workflow
1. Find work: list_tickets with projectKey ${projectKey}, status todo, and assignee unassigned. The first result is the most urgent. If I name a Ticket, work on that one.
2. Read it with get_ticket, comments included, before you start.
3. Claim it with claim_ticket. If the claim fails, someone else has it: choose another.
4. Do the work. As you go, set the Ticket's progress (0 to 100) with update_ticket so I can see how far along it is. Use add_comment for questions, blockers, and anything worth keeping.
5. When it is ready, add_comment with what changed and how you tested it, then move_ticket to review. Never move a Ticket to done yourself: a human reviews it first. To hand it to a specific human, use assign_ticket with their email.
6. If you find work outside the Ticket, create_ticket in ${projectKey} instead of widening its scope.
7. Tell me the Ticket is in review, then ask before you claim the next one.

Start now: connect, then tell me what is in To Do.`;
}
