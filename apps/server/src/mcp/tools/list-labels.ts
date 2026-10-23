import { listLabels } from "@agentkanban/domain";
import { labelView } from "@agentkanban/shared";
import { z } from "zod";
import { bulletList } from "../markdown";
import { defineTool } from "../tool";

const labelSummary = labelView.pick({ name: true, color: true, ticketCount: true });

export const listLabelsTool = defineTool({
  name: "list_labels",
  description:
    "List the company's labels, with each name, color, and how many tickets carry it, archived ones left out. Labels work across every project. Before you put a label on a ticket with create_ticket or update_ticket (by its ticket key), check here and reuse an existing name rather than making a near-duplicate. Pass a name to list_tickets as label to find the tickets that carry it.",
  input: z.object({}),
  output: z.object({ labels: z.array(labelSummary) }),
  annotations: { readOnlyHint: true },
  async run(_input, { deps, ctx }) {
    const labels = (await listLabels(deps, ctx)).map(({ name, color, ticketCount }) => ({
      name,
      color,
      ticketCount,
    }));
    const markdown = bulletList(
      "Labels",
      labels.map(
        (l) =>
          `**${l.name}** (${l.color}, ${l.ticketCount} ${l.ticketCount === 1 ? "ticket" : "tickets"})`,
      ),
      "No labels yet.",
    );
    return { data: { labels }, markdown };
  },
});
