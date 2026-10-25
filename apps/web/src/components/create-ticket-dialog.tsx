import {
  createTicketInput,
  parentTypesAllowed,
  type TicketType,
  ticketPriorities,
  ticketTypes,
} from "@agentkanban/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { EstimateInput } from "@/components/estimate-input";
import { LabelsField } from "@/components/labels-field";
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
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import { refreshLabels } from "@/lib/labels";
import { openSprints, sprintOption, sprintsQuery } from "@/lib/sprints";
import { createTicketMutation, ticketsQuery } from "@/lib/tickets";

const capitalized = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

type Props = {
  projectKey: string;
};

/**
 * The button and dialog that create a Ticket in a Project. It lands at the
 * bottom of Backlog, in the active Sprint when there is one, so it shows on the
 * board it was created from.
 */
export function CreateTicketDialog({ projectKey }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TicketType>("task");
  // Held here until submit. The field's own text box is not part of the form.
  const [labels, setLabels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The Parent choices come from the unfiltered board, so a filter never hides one.
  const { data: tickets = [] } = useQuery(ticketsQuery(projectKey));
  const create = useMutation(createTicketMutation(queryClient));
  const parents = tickets.filter((t) => parentTypesAllowed[type].includes(t.type));
  const { data: sprints = [] } = useQuery(sprintsQuery(projectKey));
  const sprintChoices = openSprints(sprints);
  const activeSprint = sprintChoices.find((s) => s.state === "active");

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setType("task");
      setLabels([]);
      setError(null);
      create.reset();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parentKey = String(form.get("parent") ?? "");
    const sprint = String(form.get("sprint") ?? "");
    // Left empty, the Estimate is blank. The shared schema refuses anything out of range.
    const estimate = String(form.get("estimate") ?? "").trim();
    const parsed = createTicketInput.safeParse({
      projectKey,
      type,
      title: form.get("title"),
      description: form.get("description"),
      priority: form.get("priority"),
      parentKey: parentKey || null,
      estimate: estimate === "" ? null : Number(estimate),
      labels,
      sprint: sprint === "" ? null : Number(sprint),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a title.");
      return;
    }
    setError(null);
    try {
      await create.mutateAsync(parsed.data);
      if (parsed.data.labels.length > 0) refreshLabels(queryClient);
      reset(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button className="h-11 md:h-9">
          <Plus />
          Create ticket
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create ticket</DialogTitle>
          <DialogDescription>It goes to the bottom of Backlog.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="ticket-type">Type</Label>
              <NativeSelect
                id="ticket-type"
                value={type}
                onChange={(event) => setType(event.target.value as TicketType)}
              >
                {ticketTypes.map((value) => (
                  <option key={value} value={value}>
                    {capitalized(value)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ticket-priority">Priority</Label>
              <NativeSelect id="ticket-priority" name="priority" defaultValue="medium">
                {ticketPriorities.map((value) => (
                  <option key={value} value={value}>
                    {capitalized(value)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ticket-title">Title</Label>
            <Input id="ticket-title" name="title" autoComplete="off" className="h-11 md:h-9" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ticket-description">Description</Label>
            <Textarea id="ticket-description" name="description" />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <div className="grid min-w-0 gap-2">
              <Label htmlFor="ticket-parent">Parent</Label>
              {/* Keyed by type, so a Parent that no longer fits is dropped when the type changes. */}
              <NativeSelect
                key={type}
                id="ticket-parent"
                name="parent"
                defaultValue=""
                disabled={type === "epic"}
              >
                <option value="">No parent</option>
                {parents.map((ticket) => (
                  <option key={ticket.key} value={ticket.key}>
                    {ticket.key} {ticket.title}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ticket-estimate">Estimate</Label>
              <EstimateInput id="ticket-estimate" name="estimate" />
            </div>
          </div>
          {sprintChoices.length > 0 && (
            <div className="grid gap-2">
              <Label htmlFor="new-ticket-sprint">Sprint</Label>
              <NativeSelect
                id="new-ticket-sprint"
                name="sprint"
                defaultValue={String(activeSprint?.number ?? "")}
              >
                <option value="">No sprint</option>
                {sprintChoices.map((s) => (
                  <option key={s.number} value={s.number}>
                    {sprintOption(s)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <LabelsField
            id="new-ticket-labels"
            value={labels}
            labelClassName=""
            onChange={setLabels}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="h-11" disabled={create.isPending}>
            Create ticket
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
