import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { UsersRound } from "lucide-react";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { projectsQuery, teamsQuery } from "@/lib/projects";

// The Company's landing page: its Projects, optionally only one Team's. The
// Team filter is the `team` search param (a Team id), so it survives a reload.
export const Route = createFileRoute("/$companySlug/")({
  validateSearch: (search: Record<string, unknown>): { team?: string } => ({
    team: typeof search.team === "string" && search.team ? search.team : undefined,
  }),
  component: Projects,
});

function Projects() {
  const { company } = Route.useRouteContext();
  const { companySlug } = Route.useParams();
  const { team } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: teams = [] } = useQuery(teamsQuery);
  const { data: projects, error } = useQuery(projectsQuery(team ?? null));

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
        <p className="text-sm text-muted-foreground">
          Your role: <span className="font-medium text-foreground">{company.role}</span>
        </p>
      </div>

      <section className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">Projects</h2>
          <div className="flex w-full items-end gap-3 sm:w-auto">
            <div className="grid min-w-0 flex-1 gap-1.5 sm:w-52 sm:flex-none">
              <Label htmlFor="team-filter" className="text-xs text-muted-foreground">
                Team
              </Label>
              <NativeSelect
                id="team-filter"
                value={team ?? ""}
                onChange={(event) =>
                  navigate({ search: { team: event.target.value || undefined }, replace: true })
                }
              >
                <option value="">All teams</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <CreateProjectDialog companySlug={companySlug} />
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            The projects did not load.
          </p>
        ) : !projects ? (
          <p className="text-sm text-muted-foreground">Loading projects.</p>
        ) : projects.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {team ? "No projects for this team." : "No projects yet."}
          </p>
        ) : (
          <ul aria-label="Projects" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  to="/$companySlug/projects/$projectKey"
                  params={{ companySlug, projectKey: project.key }}
                  className="grid h-full min-h-11 gap-2 rounded-xl border bg-card p-4 shadow-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-secondary dark:hover:bg-accent"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 text-base font-semibold [overflow-wrap:anywhere]">
                      {project.name}
                    </span>
                    <span className="shrink-0 rounded-md bg-foreground/10 px-1.5 py-0.5 font-mono text-xs">
                      {project.key}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <UsersRound className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{project.team?.name ?? "No team"}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
