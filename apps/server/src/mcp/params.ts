import { ticketKey } from "@agentkanban/shared";

/** The Ticket a tool acts on, in capitals however the model typed it. */
export const ticketKeyParam = ticketKey.toUpperCase().describe("The ticket key, such as CB-42.");

/** The other Ticket of a Ticket Link, in capitals however the model typed it. */
export const targetKeyParam = ticketKey
  .toUpperCase()
  .describe("The other ticket's key, such as CB-7.");

/** How create_ticket and update_ticket describe `estimate`. */
export const estimateDescription = "Points from 0 to 100, or null to leave it blank.";
