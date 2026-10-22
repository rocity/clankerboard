import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { projectsQuery } from "@/lib/projects";

/** The Projects that belong to a Team, each linking to its board. */
export function TeamProjects({ teamId, companySlug }: { teamId: string; companySlug: string }) {
  const projects = useQuery({ ...projectsQuery(teamId), staleTime: 0 });

  if (projects.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(projects.error)}
      </p>
    );
  }
  if (!projects.data) return <p className="text-sm text-muted-foreground">Loading projects.</p>;
  if (projects.data.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        No projects for this team yet.
      </p>
    );
  }

  return (
    <ul aria-label="Projects" className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
      {projects.data.map((project) => (
        <li key={project.id}>
          <Link
            to="/$companySlug/projects/$projectKey"
            params={{ companySlug, projectKey: project.key }}
            className="flex h-full min-h-11 items-center gap-3 rounded-xl border bg-card p-4 shadow-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-secondary dark:hover:bg-accent"
          >
            <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">
              {project.name}
            </span>
            <span className="shrink-0 rounded-md bg-foreground/10 px-1.5 py-0.5 font-mono text-xs">
              {project.key}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
