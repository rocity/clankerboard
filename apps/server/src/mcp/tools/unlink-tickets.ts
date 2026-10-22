import { unlinkTickets } from "@clankerboard/domain";
import { z } from "zod";
import { linksMarkdown } from "../markdown";
import { targetKeyParam, ticketKeyParam } from "../params";
import { defineTool } from "../tool";
import { linksWithEmails, mcpTicketLinkView } from "../views";

export const unlinkTicketsTool = defineTool({
  name: "unlink_tickets",
  description:
    "Unlink two tickets, by ticket key such as CB-42, whatever their kind (blocks, blocked_by, or relates_to). Undo it with link_tickets.",
  input: z.object({ key: ticketKeyParam, target: targetKeyParam }),
  output: z.object({ links: z.array(mcpTicketLinkView) }),
  // Not destructive: linking again restores it, and Activity keeps the record.
  annotations: { readOnlyHint: false, destructiveHint: false },
  async run({ key, target }, env) {
    await unlinkTickets(env.deps, env.ctx, key, target);
    const links = await linksWithEmails(env, key);
    return {
      data: { links },
      markdown: `${key} and ${target} are no longer linked.\n\n${linksMarkdown(links)}`,
    };
  },
});
