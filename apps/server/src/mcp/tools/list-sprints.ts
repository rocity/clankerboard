import { listSprints } from "@agentkanban/domain";
import { projectKey, type SprintView, sprintName, sprintView } from "@agentkanban/shared";
import { z } from "zod";
import { bulletList } from "../markdown";
import { defineTool } from "../tool";

const sprintSummary = sprintView.omit({ id: true, createdAt: true });
type SprintSummary = z.output<typeof sprintSummary>;

/** `**Sprint 4** [active, ends 2026-11-06, 12 tickets, 4 done, 30 pts] Goal: Ship login`. */
function sprintLine(sprint: SprintSummary) {
  const facts =
    sprint.state === "finished"
      ? [`finished ${sprint.finishedAt?.toISOString().slice(0, 10)}`]
      : [
          sprint.state,
          ...(sprint.endsOn ? [`ends ${sprint.endsOn}`] : []),
          `${sprint.ticketCount} ${sprint.ticketCount === 1 ? "ticket" : "tickets"}`,
          `${sprint.doneCount} done`,
          `${sprint.points} pts`,
        ];
  const goal = sprint.goal ? ` Goal: ${sprint.goal}` : "";
  return `**${sprintName(sprint.number)}** [${facts.join(", ")}]${goal}`;
}

export const listSprintsTool = defineTool({
  name: "list_sprints",
  description:
    "List a project's sprints by project key: each sprint's number, whether it is planned, active, or finished, its goal and end date, and its live tickets' count, done count, and points. A project runs sprints once it has one, and then its board shows only the active sprint. Put a ticket in a sprint by its ticket key with update_ticket, or give one to create_ticket, and list the active sprint's tickets with list_tickets and sprint: active. Only humans create, start, and finish sprints.",
  input: z.object({ projectKey: projectKey.describe("The project key, such as CB.") }),
  output: z.object({ sprints: z.array(sprintSummary) }),
  annotations: { readOnlyHint: true },
  async run({ projectKey: key }, { deps, ctx }) {
    const sprints = (await listSprints(deps, ctx, key)).map(
      ({ id: _id, createdAt: _createdAt, ...sprint }: SprintView) => sprint,
    );
    const markdown = bulletList(
      `${key} sprints`,
      sprints.map(sprintLine),
      `${key} has no sprints. Its board shows every ticket.`,
    );
    return { data: { sprints }, markdown };
  },
});
