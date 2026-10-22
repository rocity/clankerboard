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
import { type ReactNode, useState } from "react";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { actorsQuery } from "@/lib/actors";
import type { TicketData } from "@/lib/board";
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

type Props = {
  ticket: TicketData;
  onStatus: (status: TicketStatus) => Promise<unknown>;
  onType: (type: TicketType) => Promise<unknown>;
  onPriority: (priority: TicketPriority) => Promise<unknown>;
  onParent: (parentKey: string | null) => Promise<unknown>;
  onAssignee: (assignee: AssigneePick) => Promise<unknown>;
};

/** The fields of a Ticket that are picked from a list. Each saves on its own. */
export function TicketFields({
  ticket,
  onStatus,
  onType,
  onPriority,
  onParent,
  onAssignee,
}: Props) {
  const archived = ticket.archivedAt !== null;
  // Parent choices come from the unfiltered board, which holds only live Tickets.
  const { data: tickets = [] } = useQuery(ticketsQuery(ticket.projectKey));
  const { data: actors = [] } = useQuery(actorsQuery);

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
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
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
        className="col-span-2 md:col-span-1"
        value={ticket.type}
        onPick={(value) => onType(value as TicketType)}
      >
        {ticketTypes.map((value) => (
          <option key={value} value={value}>
            {capitalized(value)}
          </option>
        ))}
      </PickField>
      <div className="col-span-2 grid gap-3 md:col-span-3">
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
      </div>
    </div>
  );
}
