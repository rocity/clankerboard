import { McpServer } from "@modelcontextprotocol/server";
import { appVersion } from "../version";
import { registerTools, type ToolEnv } from "./tool";
import { tools } from "./tools";

/** One MCP server per request, acting as the Agent in `env.ctx`. */
export function createMcpServer(env: ToolEnv) {
  const server = new McpServer({ name: "clankerboard", version: appVersion });
  registerTools(server, tools, env);
  return server;
}
