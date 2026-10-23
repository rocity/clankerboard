import { statusLabels } from "@agentkanban/shared";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { errorMessage } from "@/lib/api";
import type { TicketData } from "@/lib/board";
import { openSprints, type SprintData, sprintOption, useSprintPick } from "@/lib/sprints";

type Props = {
  companySlug: string;
  projectKey: string;
  /** In board order. */
  tickets: TicketData[];
  sprints: SprintData[];
  /** What an empty list says. */
  empty: string;
};

/** A Sprint's Tickets, or the Tickets in no Sprint, each with a select that moves it. */
export function SprintTickets({ companySlug, projectKey, tickets, sprints, empty }: Props) {
  if (tickets.length === 0) {
    return <p className="border-t px-4 py-3 text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="divide-y border-t">
      {tickets.map((ticket) => (
        <TicketRow
          key={ticket.key}
          companySlug={companySlug}
          projectKey={projectKey}
          ticket={ticket}
          sprints={sprints}
        />
      ))}
    </ul>
  );
}

function TicketRow({
  companySlug,
  projectKey,
  ticket,
  sprints,
}: {
  companySlug: string;
  projectKey: string;
  ticket: TicketData;
  sprints: SprintData[];
}) {
  const pick = useSprintPick();
  // Shows the pick while the request is out, then what the server holds.
  const [picked, setPicked] = useState<string | null>(null);
  const value = picked ?? (ticket.sprint ? String(ticket.sprint.number) : "");
  const facts = [
    statusLabels[ticket.status],
    ...(ticket.estimate === null ? [] : [`${ticket.estimate} pts`]),
  ];

  return (
    <li
      aria-label={`${ticket.key} ${ticket.title}`}
      className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center"
    >
      <Link
        to="/$companySlug/projects/$projectKey/tickets/$ticketKey"
        params={{ companySlug, projectKey, ticketKey: ticket.key }}
        className="grid min-w-0 gap-0.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="text-sm font-medium [overflow-wrap:anywhere]">
          <span className="mr-2 font-mono text-xs text-muted-foreground">{ticket.key}</span>
          {ticket.title}
        </span>
        <span className="text-xs text-muted-foreground">{facts.join(" · ")}</span>
      </Link>
      <NativeSelect
        aria-label={`Sprint for ${ticket.key}`}
        value={value}
        disabled={pick.isPending}
        onChange={(event) => {
          const next = event.target.value;
          setPicked(next);
          pick.mutate(
            { key: ticket.key, sprint: next ? Number(next) : null },
            { onSettled: () => setPicked(null) },
          );
        }}
      >
        <option value="">No sprint</option>
        {openSprints(sprints).map((s) => (
          <option key={s.number} value={s.number}>
            {sprintOption(s)}
          </option>
        ))}
      </NativeSelect>
      {pick.error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {errorMessage(pick.error)}
        </p>
      )}
    </li>
  );
}
