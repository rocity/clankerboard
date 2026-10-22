/** The environment variable the `.mcp.json` snippet reads the key from. */
export const keyEnvVar = "CLANKERBOARD_API_KEY";

const serverName = "clankerboard";

/** The MCP endpoint of this server, from the public URL the operator configured. */
export function mcpUrl(publicUrl: string) {
  return `${publicUrl.replace(/\/+$/, "")}/mcp`;
}

/** The command that registers this server in Claude Code, with the key filled in. */
export function addCommand(publicUrl: string, secret: string) {
  return `claude mcp add --transport http ${serverName} ${mcpUrl(publicUrl)} --header "Authorization: Bearer ${secret}"`;
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

export function exportLine(secret: string) {
  return `export ${keyEnvVar}=${secret}`;
}
