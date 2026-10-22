import { linkTickets } from "@clankerboard/domain";
import { linkTicketsInput, type TicketLinkViewKind } from "@clankerboard/shared";
import { z } from "zod";
import { linksMarkdown } from "../markdown";
import { targetKeyParam, ticketKeyParam } from "../params";
import { defineTool } from "../tool";
import { linksWithEmails, mcpTicketLinkView } from "../views";

const confirmations: Record<TicketLinkViewKind, (key: string, target: string) => string> = {
  blocks: (key, target) => `${key} now blocks ${target}.`,
  blocked_by: (key, target) => `${key} is now blocked by ${target}.`,
  relates_to: (key, target) => `${key} now relates to ${target}.`,
};

export const linkTicketsTool = defineTool({
  name: "link_tickets",
  description:
    "Record how two tickets connect, by ticket key such as CB-42. Kind blocks means this ticket must be done before the target can start, blocked_by means the target must be done first, and relates_to connects them without an order. A blocked ticket can't be claimed until its blockers are done. Two tickets can be linked only once: to change the kind, unlink them with unlink_tickets first.",
  input: z.object({
    key: ticketKeyParam,
    kind: linkTicketsInput.shape.kind.describe("blocks, blocked_by, or relates_to."),
    target: targetKeyParam,
  }),
  output: z.object({ links: z.array(mcpTicketLinkView) }),
  annotations: { readOnlyHint: false, destructiveHint: false },
  async run({ key, kind, target }, env) {
    await linkTickets(env.deps, env.ctx, key, { kind, target });
    const links = await linksWithEmails(env, key);
    return {
      data: { links },
      markdown: `${confirmations[kind](key, target)}\n\n${linksMarkdown(links)}`,
    };
  },
});
