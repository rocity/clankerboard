import { statusLabels, type TicketStatus } from "@clankerboard/shared";
import { TicketSummary } from "@/components/ticket-summary";
import type { TicketData } from "@/lib/board";

type Props = {
  status: TicketStatus;
  tickets: readonly TicketData[];
};

/**
 * One Status of the board. On a phone it is nearly as wide as the screen, so a
 * Ticket reads at full width and the next Status peeks in at the edge. From the
 * `md` breakpoint the five Statuses share the row.
 */
export function StatusLane({ status, tickets }: Props) {
  const label = statusLabels[status];

  return (
    <section
      aria-label={label}
      data-status={status}
      className="flex w-[calc(100vw-3rem)] shrink-0 snap-start flex-col gap-2 rounded-xl bg-foreground/[0.04] p-2 md:w-auto md:min-w-56 md:flex-1 md:basis-0"
    >
      <header className="flex items-center justify-between px-1 pt-1">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {tickets.length}
        </span>
      </header>
      {tickets.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-muted-foreground">No tickets</p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {tickets.map((ticket) => (
            <li key={ticket.key}>
              <TicketSummary ticket={ticket} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
