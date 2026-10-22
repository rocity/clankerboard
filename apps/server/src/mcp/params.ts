import { ticketKey } from "@clankerboard/shared";

/** The Ticket a tool acts on, in capitals however the model typed it. */
export const ticketKeyParam = ticketKey.toUpperCase().describe("The ticket key, such as CB-42.");

/** How create_ticket and update_ticket describe `estimate`. */
export const estimateDescription = "Points from 0 to 100, or null to leave it blank.";
