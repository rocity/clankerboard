import { statusLabels } from "@agentkanban/shared";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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

/** How many Tickets a list shows at a time. */
export const ticketsPerPage = 20;

/**
 * A Sprint's Tickets, or the Tickets in no Sprint, each with a select that
 * moves it, a page at a time.
 */
export function SprintTickets({ companySlug, projectKey, tickets, sprints, empty }: Props) {
  const [page, setPage] = useState(0);
  if (tickets.length === 0) {
    return <p className="border-t px-4 py-3 text-sm text-muted-foreground">{empty}</p>;
  }
  // Tickets leave the list as they move, so the page can't stay past the last one.
  const pages = Math.ceil(tickets.length / ticketsPerPage);
  const current = Math.min(page, pages - 1);
  const first = current * ticketsPerPage;
  const shown = tickets.slice(first, first + ticketsPerPage);
  return (
    <>
      <ul className="divide-y border-t">
        {shown.map((ticket) => (
          <TicketRow
            key={ticket.key}
            companySlug={companySlug}
            projectKey={projectKey}
            ticket={ticket}
            sprints={sprints}
          />
        ))}
      </ul>
      {pages > 1 && (
        <nav
          aria-label="Pages"
          className="flex items-center justify-between gap-3 border-t px-4 py-2"
        >
          <p className="text-sm text-muted-foreground">
            {first + 1}–{first + shown.length} of {tickets.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-8"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              <ChevronLeft />
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-8"
              disabled={current === pages - 1}
              onClick={() => setPage(current + 1)}
            >
              Next
              <ChevronRight />
            </Button>
          </div>
        </nav>
      )}
    </>
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
