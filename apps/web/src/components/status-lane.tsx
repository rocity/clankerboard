import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { statusLabels, type TicketStatus } from "@clankerboard/shared";
import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { DraggableTicket, isTicketData } from "@/components/draggable-ticket";
import { RestoreTicketButton } from "@/components/restore-ticket-button";
import { TicketSummary } from "@/components/ticket-summary";
import type { TicketData } from "@/lib/board";
import { cn } from "@/lib/utils";

type Props = {
  status: TicketStatus;
  tickets: readonly TicketData[];
};

/** What a Status answers as a drop target: a drop on it, not on a Ticket, goes to the end. */
export type StatusDropData = { type: "status"; status: TicketStatus };

/**
 * One Status of the board. On a phone it is nearly as wide as the screen, so a
 * Ticket reads at full width and the next Status peeks in at the edge. From the
 * `md` breakpoint the five Statuses share the row. The whole Status takes a
 * drop, so an empty one is as easy to hit as a full one.
 */
export function StatusLane({ status, tickets }: Props) {
  const label = statusLabels[status];
  const ref = useRef<HTMLElement>(null);
  const [receiving, setReceiving] = useState(false);
  const { companySlug, projectKey } = useParams({ from: "/$companySlug/projects/$projectKey" });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return dropTargetForElements({
      element,
      canDrop: ({ source }) => isTicketData(source.data),
      getData: (): StatusDropData => ({ type: "status", status }),
      onDragStart: () => setReceiving(true),
      onDragEnter: () => setReceiving(true),
      onDragLeave: () => setReceiving(false),
      onDrop: () => setReceiving(false),
    });
  }, [status]);

  return (
    <section
      ref={ref}
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
      {tickets.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-muted-foreground">No tickets</p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)]">
          {tickets.map((ticket) => (
            <DraggableTicket key={ticket.key} ticket={ticket}>
              <Link
                to="/$companySlug/projects/$projectKey/tickets/$ticketKey"
                params={{ companySlug, projectKey, ticketKey: ticket.key }}
                // The board's filters live in its search params, so opening a Ticket keeps them.
                search={(prev) => prev}
                // The Ticket is the draggable, not its link: a dragged link would carry a URL instead.
                draggable={false}
                className="block rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <TicketSummary ticket={ticket} />
              </Link>
              {ticket.archivedAt && (
                <RestoreTicketButton ticketKey={ticket.key} title={ticket.title} />
              )}
            </DraggableTicket>
          ))}
        </ul>
      )}
    </section>
  );
}
