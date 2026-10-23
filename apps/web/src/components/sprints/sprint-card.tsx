import { sprintName } from "@agentkanban/shared";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FinishSprintButton, StartSprintButton } from "@/components/sprint-dialogs";
import { SprintTickets } from "@/components/sprints/sprint-tickets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import type { TicketData } from "@/lib/board";
import {
  calendarDay,
  endsLabel,
  type SprintData,
  sprintTotals,
  useSprintMutations,
} from "@/lib/sprints";

type Props = {
  companySlug: string;
  projectKey: string;
  sprint: SprintData;
  /** Every Sprint of the Project, for the Tickets' selects. */
  sprints: SprintData[];
  /** This Sprint's live Tickets, in board order. */
  tickets: TicketData[];
  /** A Planned Sprint can start only while no Sprint is active. */
  canStart: boolean;
};

/**
 * The active Sprint or a Planned one: its name and dates, what its Tickets add
 * up to, its goal (saved on Enter or blur), what can be done with it, and its Tickets.
 */
export function SprintCard({ companySlug, projectKey, sprint, sprints, tickets, canStart }: Props) {
  const { update, remove } = useSprintMutations(projectKey);
  const [deleting, setDeleting] = useState(false);
  const name = sprintName(sprint.number);
  const active = sprint.state === "active";
  const dates =
    active && sprint.startedAt && sprint.endsOn
      ? `Started ${calendarDay(sprint.startedAt.slice(0, 10))} · ${endsLabel(sprint.endsOn)} · `
      : "";

  return (
    <section aria-label={name} className="rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="grid min-w-0 gap-1">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            {name}
            <Badge variant={active ? "default" : "secondary"}>
              {active ? "Active" : "Planned"}
            </Badge>
          </h2>
          <p className="text-sm text-muted-foreground">
            {dates}
            {sprintTotals(tickets)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {active && <FinishSprintButton projectKey={projectKey} sprint={sprint} />}
          {!active && canStart && <StartSprintButton projectKey={projectKey} sprint={sprint} />}
          {!active && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 text-muted-foreground hover:text-destructive md:size-9"
              aria-label={`Delete ${name}`}
              onClick={() => setDeleting(true)}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-1.5 px-4 pb-4">
        {/* Keyed by the goal, so a saved or refused edit starts again from what the server holds. */}
        <GoalField
          key={sprint.goal}
          label={`Goal for ${name}`}
          goal={sprint.goal}
          onSave={(goal) => update.mutateAsync({ number: sprint.number, goal })}
        />
        {update.error && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(update.error)}
          </p>
        )}
      </div>

      <SprintTickets
        companySlug={companySlug}
        projectKey={projectKey}
        tickets={tickets}
        sprints={sprints}
        empty="No tickets yet. Move one here with the select on its row."
      />

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${name}?`}
        description={
          tickets.length === 0
            ? "It has no tickets."
            : `Its ${tickets.length === 1 ? "ticket goes" : `${tickets.length} tickets go`} back to no sprint.`
        }
        confirmLabel="Delete sprint"
        onConfirm={() => remove.mutateAsync(sprint.number)}
      />
    </section>
  );
}

/** A Sprint's goal, saved on Enter or when the field loses focus, and put back on Escape. */
function GoalField({
  label,
  goal,
  onSave,
}: {
  label: string;
  goal: string;
  onSave: (goal: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(goal);

  async function save() {
    if (draft.trim() === goal) return;
    try {
      await onSave(draft.trim());
    } catch {
      // The card shows the server's message; the field goes back to the saved goal.
      setDraft(goal);
    }
  }

  return (
    <Input
      aria-label={label}
      value={draft}
      placeholder="Add a goal"
      maxLength={500}
      autoComplete="off"
      className="h-11 md:h-9"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void save()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void save();
        }
        if (event.key === "Escape") setDraft(goal);
      }}
    />
  );
}
