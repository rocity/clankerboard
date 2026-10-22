import { ticketKey } from "@agentkanban/shared";

/** The Ticket a tool acts on, in capitals however the model typed it. */
export const ticketKeyParam = ticketKey.toUpperCase().describe("The ticket key, such as CB-42.");
