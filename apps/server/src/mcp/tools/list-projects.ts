import { listProjects } from "@clankerboard/domain";
import { projectView } from "@clankerboard/shared";
import { z } from "zod";
import { bulletList } from "../markdown";
import { defineTool } from "../tool";

const projectSummary = projectView.pick({ key: true, name: true, team: true });

export const listProjectsTool = defineTool({
  name: "list_projects",
  description:
    "List the projects you can access, with each project key, name, and team. Ticket keys start with their project key, such as CB-42.",
  input: z.object({}),
  output: z.object({ projects: z.array(projectSummary) }),
  annotations: { readOnlyHint: true },
  async run(_input, { deps, ctx }) {
    const projects = (await listProjects(deps, ctx, {})).map(({ key, name, team }) => ({
      key,
      name,
      team,
    }));
    const markdown = bulletList(
      "Projects",
      projects.map((p) => `**${p.key}** ${p.name}${p.team ? ` (team: ${p.team.name})` : ""}`),
      "No projects yet.",
    );
    return { data: { projects }, markdown };
  },
});
