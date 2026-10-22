import type { Tool } from "../tool";
import { addCommentTool } from "./add-comment";
import { createTicketTool } from "./create-ticket";
import { getTicketTool } from "./get-ticket";
import { listProjectsTool } from "./list-projects";
import { moveTicketTool } from "./move-ticket";
import { updateTicketTool } from "./update-ticket";

/** Every tool `/mcp` offers. Agents get no delete, archive, or restore tools. */
export const tools: Tool[] = [
  listProjectsTool,
  getTicketTool,
  createTicketTool,
  updateTicketTool,
  moveTicketTool,
  addCommentTool,
];
