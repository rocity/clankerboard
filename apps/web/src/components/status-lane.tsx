import { statusLabels, type TicketStatus } from "@clankerboard/shared";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableTicket } from "@/components/sortable-ticket";
import type { TicketData } from "@/lib/board";
import { cn } from "@/lib/utils";

type Props = {
  status: TicketStatus;
  tickets: readonly TicketData[];
  /** True while a held Ticket is over this Status. */
  receiving?: boolean;
};

/** The droppable id of a Status. Ticket Keys never start with `status:`. */
export const statusDropId = (status: TicketStatus) => `status:${status}`;

/**
 * One Status of the board. On a phone it is nearly as wide as the screen, so a
 * Ticket reads at full width and the next Status peeks in at the edge. From the
 * `md` breakpoint the five Statuses share the row. The whole Status takes a
 * drop, so an empty one is as easy to hit as a full one.
 */
export function StatusLane({ status, tickets, receiving }: Props) {
  const label = statusLabels[status];
  const { setNodeRef } = useDroppable({ id: statusDropId(status) });

  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      data-status={status}
      data-receiving={receiving || undefined}
      className={cn(
        "flex min-h-40 w-[calc(100vw-3rem)] shrink-0 snap-start flex-col gap-2 rounded-xl bg-foreground/[0.04] p-2 transition-shadow md:w-auto md:min-w-56 md:flex-1 md:basis-0",
        receiving && "ring-2 ring-ring/60",
      )}
    >
      <header className="flex items-center justify-between px-1 pt-1">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {tickets.length}
        </span>
      </header>
      <SortableContext items={tickets.map((t) => t.key)} strategy={verticalListSortingStrategy}>
        {tickets.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">No tickets</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {tickets.map((ticket) => (
              <SortableTicket key={ticket.key} ticket={ticket} />
            ))}
          </ul>
        )}
      </SortableContext>
    </section>
  );
}
