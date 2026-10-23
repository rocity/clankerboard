import type { Tool } from "../tool";
import { addCommentTool } from "./add-comment";
import { assignTicketTool } from "./assign-ticket";
import { claimTicketTool } from "./claim-ticket";
import { createTicketTool } from "./create-ticket";
import { getTicketTool } from "./get-ticket";
import { linkTicketsTool } from "./link-tickets";
import { listLabelsTool } from "./list-labels";
import { listProjectsTool } from "./list-projects";
import { listTicketsTool } from "./list-tickets";
import { moveTicketTool } from "./move-ticket";
import { unlinkTicketsTool } from "./unlink-tickets";
import { updateTicketTool } from "./update-ticket";

/** Every tool `/mcp` offers. Agents get no delete, archive, or restore tools. */
export const tools: Tool[] = [
  listProjectsTool,
  listTicketsTool,
  getTicketTool,
  claimTicketTool,
  assignTicketTool,
  createTicketTool,
  updateTicketTool,
  moveTicketTool,
  addCommentTool,
  linkTicketsTool,
  unlinkTicketsTool,
  listLabelsTool,
];
