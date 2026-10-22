import { McpServer } from "@modelcontextprotocol/server";
import { appVersion } from "../version";
import { type BoardConfig, registerBoardResource } from "./resources/board";
import { registerTools, type ToolEnv } from "./tool";
import { tools } from "./tools";

export type McpConfig = { board: BoardConfig };

/** One MCP server per request, acting as the Agent in `env.ctx`. */
export function createMcpServer(env: ToolEnv, config: McpConfig) {
  const server = new McpServer({ name: "agentkanban", version: appVersion });
  registerTools(server, tools, env);
  registerBoardResource(server, env, config.board);
  return server;
}
