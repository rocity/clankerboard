import { ticketKey } from "@agentkanban/shared";

/** The Ticket a tool acts on, in capitals however the model typed it. */
export const ticketKeyParam = ticketKey.toUpperCase().describe("The ticket key, such as CB-42.");

/** The other Ticket of a Ticket Link, in capitals however the model typed it. */
export const targetKeyParam = ticketKey
  .toUpperCase()
  .describe("The other ticket's key, such as CB-7.");

/** How create_ticket and update_ticket describe `estimate`. */
export const estimateDescription = "Points from 0 to 100, or null to leave it blank.";

/** How create_ticket describes `labels`. */
export const labelsDescription =
  "Label names, such as api. A name no label has yet creates one. Check list_labels first and reuse existing names.";

/** How create_ticket and update_ticket describe `sprint`. */
export const sprintDescription =
  "The number of a planned or active sprint in the ticket's project to put it in, such as 4, or null for no sprint. See list_sprints. Epics are never in a sprint.";

/** How create_ticket and update_ticket describe `progress`. */
export const progressDescription =
  "How far along the work is, from 0 to 100, or null to leave it blank. Update it as you work.";
