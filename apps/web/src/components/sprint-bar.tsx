import { sprintName } from "@agentkanban/shared";
import { Link } from "@tanstack/react-router";
import { FinishSprintButton, StartSprintButton } from "@/components/sprint-dialogs";
import { Button } from "@/components/ui/button";
import { endsLabel, type SprintMode } from "@/lib/sprints";

type Props = {
  companySlug: string;
  projectKey: string;
  /** Only shown for a Project that runs Sprints. */
  mode: Exclude<SprintMode, { kind: "off" }>;
};

/**
 * What the board is showing, above its filters: the active Sprint with its end
 * date, goal, and Finish sprint, or that none is active, with the next Planned
 * Sprint ready to start, or a way to the Sprints page to plan one.
 */
export function SprintBar({ companySlug, projectKey, mode }: Props) {
  return (
    <section
      aria-label="Sprint"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
    >
      {mode.kind === "active" ? (
        <>
          <div className="grid min-w-0 gap-0.5">
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-semibold">{sprintName(mode.sprint.number)}</span>
              <span className="text-muted-foreground">
                {mode.sprint.endsOn && endsLabel(mode.sprint.endsOn)}
              </span>
            </p>
            {mode.sprint.goal && (
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {mode.sprint.goal}
              </p>
            )}
          </div>
          <FinishSprintButton projectKey={projectKey} sprint={mode.sprint} />
        </>
      ) : (
        <>
          <p className="text-sm">
            <span className="font-semibold">No active sprint.</span>{" "}
            <span className="text-muted-foreground">
              {mode.next
                ? `Start ${sprintName(mode.next.number)} to fill the board.`
                : "Plan one to fill the board."}
            </span>
          </p>
          {mode.next ? (
            <StartSprintButton projectKey={projectKey} sprint={mode.next} />
          ) : (
            <Button asChild variant="outline" className="h-11 md:h-9">
              <Link
                to="/$companySlug/projects/$projectKey/sprints"
                params={{ companySlug, projectKey }}
              >
                Plan sprints
              </Link>
            </Button>
          )}
        </>
      )}
    </section>
  );
}
