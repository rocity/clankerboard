import { sprintName, startSprintInput } from "@agentkanban/shared";
import { useQuery } from "@tanstack/react-query";
import { Flag, Play } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import {
  finishSummary,
  type SprintData,
  sprintsQuery,
  suggestedEnd,
  useSprintMutations,
} from "@/lib/sprints";
import { ticketsQuery } from "@/lib/tickets";
import { cn } from "@/lib/utils";

type Props = {
  projectKey: string;
  sprint: SprintData;
  className?: string;
};

/**
 * The Finish sprint button and its confirmation, which says from the board's
 * live Tickets how many are archived and how many move on, and to where.
 */
export function FinishSprintButton({ projectKey, sprint, className }: Props) {
  const [open, setOpen] = useState(false);
  const { data: sprints = [] } = useQuery(sprintsQuery(projectKey));
  // The unfiltered board: every live Ticket of the Project, whatever the filters.
  const { data: tickets = [] } = useQuery(ticketsQuery(projectKey));
  const { finish } = useSprintMutations(projectKey);
  const name = sprintName(sprint.number);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn("h-11 md:h-9", className)}
        onClick={() => setOpen(true)}
      >
        <Flag />
        Finish sprint
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Finish ${name}?`}
        description={finishSummary(sprint, sprints, tickets)}
        confirmLabel="Finish sprint"
        onConfirm={() => finish.mutateAsync(sprint.number)}
      />
    </>
  );
}

/** The Start sprint button and its dialog: the end date, defaulted, and the goal. */
export function StartSprintButton({ projectKey, sprint, className }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: sprints = [] } = useQuery(sprintsQuery(projectKey));
  const { start } = useSprintMutations(projectKey);
  const name = sprintName(sprint.number);

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setError(null);
      start.reset();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = startSprintInput.safeParse({
      endsOn: form.get("endsOn") || undefined,
      goal: form.get("goal"),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Give the end date as YYYY-MM-DD.");
      return;
    }
    setError(null);
    try {
      await start.mutateAsync({ number: sprint.number, ...parsed.data });
      reset(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button type="button" className={cn("h-11 md:h-9", className)}>
          <Play />
          Start sprint
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start {name}</DialogTitle>
          <DialogDescription>The board shows its tickets until it finishes.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <div className="grid gap-2">
            <Label htmlFor="sprint-ends-on">End date</Label>
            <Input
              id="sprint-ends-on"
              name="endsOn"
              type="date"
              required
              defaultValue={suggestedEnd(sprints)}
              className="h-11 md:h-9 dark:[color-scheme:dark]"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sprint-goal">Goal</Label>
            <Textarea id="sprint-goal" name="goal" maxLength={500} defaultValue={sprint.goal} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="h-11" disabled={start.isPending}>
            Start sprint
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
