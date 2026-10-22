import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, Outlet } from "@tanstack/react-router";
import { ChevronLeft, UsersRound } from "lucide-react";
import { Board } from "@/components/board";
import { CreateTicketDialog } from "@/components/create-ticket-dialog";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { projectQuery } from "@/lib/projects";
import { ticketsQuery } from "@/lib/tickets";

// A Project's board. Ticket routes (the detail panel) nest under this one, so
// the board stays mounted behind them: they render through the Outlet.
export const Route = createFileRoute("/$companySlug/projects/$projectKey")({
  loader: async ({ context, params }) => {
    const { queryClient } = context;
    try {
      await Promise.all([
        queryClient.ensureQueryData(projectQuery(params.projectKey)),
        queryClient.ensureQueryData(ticketsQuery(params.projectKey)),
      ]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) throw notFound();
      throw error;
    }
  },
  component: ProjectBoard,
  notFoundComponent: ProjectNotFound,
});

function ProjectBoard() {
  const { companySlug, projectKey } = Route.useParams();
  const { data: project } = useQuery(projectQuery(projectKey));

  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        <Link
          to="/$companySlug"
          params={{ companySlug }}
          className="-ml-2 flex min-h-11 w-fit items-center gap-1 rounded-md px-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Projects
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="min-w-0 text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
                {project?.name ?? projectKey}
              </h1>
              <span className="shrink-0 rounded-md bg-foreground/10 px-1.5 py-0.5 font-mono text-xs">
                {projectKey}
              </span>
            </div>
            {project?.team && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <UsersRound className="size-3.5" aria-hidden />
                {project.team.name}
              </p>
            )}
          </div>
          <CreateTicketDialog projectKey={projectKey} />
        </div>
      </div>
      <Board projectKey={projectKey} />
      <Outlet />
    </div>
  );
}

function ProjectNotFound() {
  const { companySlug } = Route.useParams();

  return (
    <div className="mx-auto grid max-w-sm gap-4 py-12 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Project not found</h1>
      <p className="text-sm text-muted-foreground">This company has no project with this key.</p>
      <Button asChild className="h-11">
        <Link to="/$companySlug" params={{ companySlug }}>
          Back to projects
        </Link>
      </Button>
    </div>
  );
}
