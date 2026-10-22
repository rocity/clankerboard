import type { Tool } from "../tool";
import { getTicketTool } from "./get-ticket";
import { listProjectsTool } from "./list-projects";
import { listTicketsTool } from "./list-tickets";

/** Every tool `/mcp` offers. Agents get no delete, archive, or restore tools. */
export const tools: Tool[] = [listProjectsTool, getTicketTool, listTicketsTool];
