import { sprintName } from "@agentkanban/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChevronLeft, Plus } from "lucide-react";
import { NoSprintCard } from "@/components/sprints/no-sprint-card";
import { SprintCard } from "@/components/sprints/sprint-card";
import { Button } from "@/components/ui/button";
import { ApiError, errorMessage } from "@/lib/api";
import { compareTickets } from "@/lib/board";
import { projectQuery } from "@/lib/projects";
import { calendarDay, plannedSprints, sprintsQuery, useSprintMutations } from "@/lib/sprints";
import { ticketsQuery } from "@/lib/tickets";

// A Project's Sprints, for planning. It is a page of its own, not nested under
// the board route, so the board is not mounted behind it.
export const Route = createFileRoute("/$companySlug/projects/$projectKey_/sprints")({
  loader: async ({ context, params }) => {
    const { queryClient } = context;
    try {
      await Promise.all([
        queryClient.ensureQueryData(projectQuery(params.projectKey)),
        queryClient.ensureQueryData(sprintsQuery(params.projectKey)),
        queryClient.ensureQueryData(ticketsQuery(params.projectKey)),
      ]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) throw notFound();
      throw error;
    }
  },
  component: SprintsPage,
  notFoundComponent: () => (
    <p className="mx-auto py-12 text-center text-sm text-muted-foreground">
      This company has no project with this key.
    </p>
  ),
});

function SprintsPage() {
  const { companySlug, projectKey } = Route.useParams();
  const { data: project } = useQuery(projectQuery(projectKey));
  const { data: sprints = [] } = useQuery(sprintsQuery(projectKey));
  // Every live Ticket of the Project. Their snapshots follow the live stream.
  const { data: tickets = [] } = useQuery(ticketsQuery(projectKey));
  const { create } = useSprintMutations(projectKey);

  const sorted = [...tickets].sort(compareTickets);
  const inSprint = (number: number) => sorted.filter((t) => t.sprint?.number === number);
  // Epics never go in a Sprint, so they are not planned here.
  const unplanned = sorted.filter((t) => t.sprint === null && t.type !== "epic");
  const active = sprints.find((s) => s.state === "active");
  const planned = plannedSprints(sprints);
  const finished = sprints
    .filter((s) => s.state === "finished")
    .sort((a, b) => b.number - a.number);
  const cardProps = { companySlug, projectKey, sprints, canStart: !active };

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <div className="grid gap-3">
        <Link
          to="/$companySlug/projects/$projectKey"
          params={{ companySlug, projectKey }}
          className="-ml-2 flex min-h-11 w-fit items-center gap-1 rounded-md px-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Board
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Sprints</h1>
            <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {project?.name ?? projectKey}{" "}
              <span className="rounded-md bg-foreground/10 px-1.5 py-0.5 font-mono text-xs text-foreground">
                {projectKey}
              </span>
            </p>
          </div>
          <Button
            type="button"
            className="h-11 md:h-9"
            disabled={create.isPending}
            onClick={() => create.mutate({ goal: "" })}
          >
            <Plus />
            Create sprint
          </Button>
        </div>
        {create.error && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(create.error)}
          </p>
        )}
        {sprints.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No sprints yet. Once this project has one, its board shows only the active sprint.
          </p>
        )}
      </div>

      {active && <SprintCard {...cardProps} sprint={active} tickets={inSprint(active.number)} />}
      {planned.map((sprint) => (
        <SprintCard
          key={sprint.number}
          {...cardProps}
          sprint={sprint}
          tickets={inSprint(sprint.number)}
        />
      ))}

      <NoSprintCard
        companySlug={companySlug}
        projectKey={projectKey}
        sprints={sprints}
        tickets={unplanned}
      />

      {finished.length > 0 && (
        <section aria-label="Finished sprints" className="grid gap-3">
          <h2 className="text-base font-semibold">Finished</h2>
          <ul className="divide-y rounded-xl border bg-card text-card-foreground shadow-sm">
            {finished.map((sprint) => (
              <li key={sprint.number} className="grid gap-0.5 px-4 py-3">
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium">{sprintName(sprint.number)}</span>
                  <span className="text-muted-foreground">
                    {sprint.finishedAt && `Finished ${calendarDay(sprint.finishedAt.slice(0, 10))}`}
                  </span>
                </p>
                {sprint.goal && (
                  <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    {sprint.goal}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
