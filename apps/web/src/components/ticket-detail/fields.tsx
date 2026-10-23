import {
  parentTypesAllowed,
  statusLabels,
  type TicketPriority,
  type TicketStatus,
  type TicketType,
  ticketPriorities,
  ticketStatuses,
  ticketTypes,
} from "@agentkanban/shared";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";
import { EstimateInput, ProgressInput } from "@/components/estimate-input";
import { ProgressBar } from "@/components/progress-bar";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { actorsQuery } from "@/lib/actors";
import type { TicketData } from "@/lib/board";
import { openSprints, sprintOption, sprintsQuery } from "@/lib/sprints";
import type { AssigneePick } from "@/lib/ticket-detail";
import { ticketsQuery } from "@/lib/tickets";
import { capitalized } from "@/lib/timeline";
import { cn } from "@/lib/utils";

type PickProps = {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  className?: string;
  /** Saves the pick. Resolves once the server has answered, whether or not it accepted. */
  onPick: (value: string) => Promise<unknown>;
  children: ReactNode;
};

/**
 * A select that saves as soon as a value is picked. It shows the pick while the
 * request is out, then goes back to what the server holds (the new value, or the
 * old one if the server refused).
 */
function PickField({ id, label, value, disabled, className, onPick, children }: PickProps) {
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <NativeSelect
        id={id}
        value={picked ?? value}
        disabled={disabled}
        onChange={(event) => {
          setPicked(event.target.value);
          void onPick(event.target.value).finally(() => setPicked(null));
        }}
      >
        {children}
      </NativeSelect>
    </div>
  );
}

type NumberProps = {
  id: string;
  label: string;
  value: number | null;
  /** The input to type in: `EstimateInput` or `ProgressInput`. */
  input: typeof EstimateInput;
  /** Saves the number. Resolves once the server has answered, whether or not it accepted. */
  onSave: (value: number | null) => Promise<unknown>;
};

/**
 * The Estimate or the Progress, typed in and saved on Enter or when the field
 * loses focus. Emptying it clears the value. Like the selects, it shows the
 * draft while the request is out, then goes back to what the server holds.
 * The server checks the range, so its own message is the one shown.
 */
function NumberField({ id, label, value, input: NumberInput, onSave }: NumberProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const saving = useRef(false);
  const shown = draft ?? (value === null ? "" : String(value));

  async function save(input: HTMLInputElement) {
    if (draft === null || saving.current) return;
    // Text a number field can't read (such as a lone "e") is dropped, not saved as blank.
    if (input.validity.badInput) {
      setDraft(null);
      return;
    }
    const text = draft.trim();
    const next = text === "" ? null : Number(text);
    if (next !== value) {
      saving.current = true;
      await onSave(next);
      saving.current = false;
    }
    setDraft(null);
  }

  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <NumberInput
        id={id}
        value={shown}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => void save(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void save(event.currentTarget);
          }
          if (event.key === "Escape") setDraft(null);
        }}
      />
    </div>
  );
}

type Props = {
  ticket: TicketData;
  onStatus: (status: TicketStatus) => Promise<unknown>;
  onType: (type: TicketType) => Promise<unknown>;
  onPriority: (priority: TicketPriority) => Promise<unknown>;
  onEstimate: (estimate: number | null) => Promise<unknown>;
  onProgress: (progress: number | null) => Promise<unknown>;
  onParent: (parentKey: string | null) => Promise<unknown>;
  onSprint: (sprint: number | null) => Promise<unknown>;
  onAssignee: (assignee: AssigneePick) => Promise<unknown>;
};

/**
 * The fields of a Ticket that are picked from a list, the Estimate, and the
 * Progress, which has a row of its own with its bar. Each saves on its own.
 * The Sprint shows once the Project has Sprints.
 */
export function TicketFields({
  ticket,
  onStatus,
  onType,
  onPriority,
  onEstimate,
  onProgress,
  onParent,
  onSprint,
  onAssignee,
}: Props) {
  const archived = ticket.archivedAt !== null;
  // Parent choices come from the unfiltered board, which holds only live Tickets.
  const { data: tickets = [] } = useQuery(ticketsQuery(ticket.projectKey));
  const { data: actors = [] } = useQuery(actorsQuery);
  const { data: sprints = [] } = useQuery(sprintsQuery(ticket.projectKey));
  const sprintChoices = openSprints(sprints);
  // A Ticket archived in a Sprint that has since finished still shows where it was.
  const finishedSprint = ticket.sprint?.state === "finished" ? ticket.sprint : null;

  const parents = tickets.filter((t) => parentTypesAllowed[ticket.type].includes(t.type));
  const current = ticket.parent;
  const hasCurrent = current ? parents.some((p) => p.key === current.key) : true;

  const assigneeValue = ticket.assignee ? `${ticket.assignee.type}:${ticket.assignee.id}` : "";
  // A revoked Agent can't be picked, but it stays shown while it holds the Ticket.
  const assignable = actors.filter((a) => !a.revoked || `${a.type}:${a.id}` === assigneeValue);
  const users = assignable.filter((a) => a.type === "user");
  const agents = assignable.filter((a) => a.type === "agent");
  const optionLabel = (a: { name: string; revoked: boolean }) =>
    a.revoked ? `${a.name} (revoked)` : a.name;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <PickField
        id="ticket-status"
        label="Status"
        value={ticket.status}
        disabled={archived}
        onPick={(value) => onStatus(value as TicketStatus)}
      >
        {ticketStatuses.map((status) => (
          <option key={status} value={status}>
            {statusLabels[status]}
          </option>
        ))}
      </PickField>
      <PickField
        id="ticket-priority"
        label="Priority"
        value={ticket.priority}
        onPick={(value) => onPriority(value as TicketPriority)}
      >
        {ticketPriorities.map((value) => (
          <option key={value} value={value}>
            {capitalized(value)}
          </option>
        ))}
      </PickField>
      <PickField
        id="ticket-type"
        label="Type"
        value={ticket.type}
        onPick={(value) => onType(value as TicketType)}
      >
        {ticketTypes.map((value) => (
          <option key={value} value={value}>
            {capitalized(value)}
          </option>
        ))}
      </PickField>
      <NumberField
        id="ticket-estimate"
        label="Estimate"
        value={ticket.estimate}
        input={EstimateInput}
        onSave={onEstimate}
      />
      <div className="col-span-2 grid grid-cols-[7rem_minmax(0,1fr)] items-end gap-3 md:col-span-4">
        <NumberField
          id="ticket-progress"
          label="Progress"
          value={ticket.progress}
          input={ProgressInput}
          onSave={onProgress}
        />
        {/* The bar sits level with the field, so the row reads as one thing. */}
        <div className="flex h-11 items-center md:h-9">
          {ticket.progress === null ? (
            <span className="text-sm text-muted-foreground">Not reported</span>
          ) : (
            <ProgressBar value={ticket.progress} className="w-full" />
          )}
        </div>
      </div>
      <div className="col-span-2 grid gap-3 md:col-span-4">
        <PickField
          id="ticket-assignee"
          label="Assignee"
          value={assigneeValue}
          disabled={archived}
          onPick={(value) => {
            const [type, id] = value.split(":");
            return onAssignee(value ? { type: type as "user" | "agent", id: id ?? "" } : null);
          }}
        >
          <option value="">Unassigned</option>
          {users.length > 0 && (
            <optgroup label="Users">
              {users.map((a) => (
                <option key={a.id} value={`user:${a.id}`}>
                  {optionLabel(a)}
                </option>
              ))}
            </optgroup>
          )}
          {agents.length > 0 && (
            <optgroup label="Agents">
              {agents.map((a) => (
                <option key={a.id} value={`agent:${a.id}`}>
                  {optionLabel(a)}
                </option>
              ))}
            </optgroup>
          )}
        </PickField>
        <PickField
          id="ticket-parent"
          label="Parent"
          value={current?.key ?? ""}
          disabled={ticket.type === "epic"}
          onPick={(value) => onParent(value || null)}
        >
          <option value="">No parent</option>
          {!hasCurrent && current && (
            <option value={current.key}>
              {current.key} {current.title}
            </option>
          )}
          {parents.map((p) => (
            <option key={p.key} value={p.key}>
              {p.key} {p.title}
            </option>
          ))}
        </PickField>
        {(sprints.length > 0 || ticket.sprint) && (
          <PickField
            id="ticket-sprint"
            label="Sprint"
            value={ticket.sprint ? String(ticket.sprint.number) : ""}
            disabled={archived || ticket.type === "epic"}
            onPick={(value) => onSprint(value ? Number(value) : null)}
          >
            <option value="">No sprint</option>
            {sprintChoices.map((s) => (
              <option key={s.number} value={s.number}>
                {sprintOption(s)}
              </option>
            ))}
            {finishedSprint && (
              <option value={finishedSprint.number}>{sprintOption(finishedSprint)}</option>
            )}
          </PickField>
        )}
      </div>
    </div>
  );
}
