import { ticketStatuses } from "@agentkanban/shared";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  autoScrollForElements,
  autoScrollWindowForElements,
} from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/extract-closest-edge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { isTicketData } from "@/components/draggable-ticket";
import { type StatusDropData, StatusLane } from "@/components/status-lane";
import { groupByStatus } from "@/lib/board";
import { moveTicket, placeTicket } from "@/lib/move-ticket";
import { type BoardFilters, isFiltered, ticketsQuery } from "@/lib/tickets";
import { cn } from "@/lib/utils";

type Props = {
  projectKey: string;
  filters?: BoardFilters;
};

const isStatusData = (data: Record<string | symbol, unknown>): data is StatusDropData =>
  data.type === "status";

/**
 * The Board of one Project: one lane per Status, each in rank order. A Ticket
 * can be dragged within a Status or to another one. The drop is the only thing
 * the board handles: it works out where the Ticket landed and hands that to
 * `moveTicket`, which updates the cache at once and asks the server.
 */
export function Board({ projectKey, filters = {} }: Props) {
  const { data, error, refetch, isPlaceholderData } = useQuery({
    ...ticketsQuery(projectKey, filters),
    // While a new filter loads, keep showing the last view of this Project instead of a blank.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === projectKey ? previous : undefined,
  });
  const queryClient = useQueryClient();
  const scroller = useRef<HTMLDivElement>(null);
  const [holding, setHolding] = useState(false);
  const byStatus = useMemo(() => groupByStatus(data ?? []), [data]);

  // The drop handler outlives renders, so it reads the latest board through a ref.
  const latest = useRef({ byStatus, filtered: isFiltered(filters) });
  latest.current = { byStatus, filtered: isFiltered(filters) };

  const ready = Boolean(data);
  useEffect(() => {
    if (!ready) return;
    return combine(
      monitorForElements({
        canMonitor: ({ source }) => isTicketData(source.data),
        onDragStart: () => setHolding(true),
        onDrop: ({ source, location }) => {
          setHolding(false);
          const target = location.current.dropTargets[0];
          if (!target || !isTicketData(source.data)) return;
          const { byStatus: lanes, filtered } = latest.current;
          const all = ticketStatuses.flatMap((s) => lanes[s]);
          const ticket = all.find((t) => t.key === source.data.key);
          if (!ticket) return;

          let status = ticket.status;
          let overKey: string | null = null;
          let edge: "top" | "bottom" | null = null;
          if (isStatusData(target.data)) {
            status = target.data.status;
          } else if (isTicketData(target.data)) {
            overKey = target.data.key;
            if (overKey === ticket.key) return;
            edge = extractClosestEdge(target.data) === "top" ? "top" : "bottom";
            status = all.find((t) => t.key === overKey)?.status ?? status;
          }
          const placement = placeTicket(lanes, ticket, status, overKey, edge);
          if (placement) void moveTicket(queryClient, ticket, placement, { filtered });
        },
      }),
      autoScrollWindowForElements({ canScroll: ({ source }) => isTicketData(source.data) }),
      scroller.current
        ? autoScrollForElements({
            element: scroller.current,
            canScroll: ({ source }) => isTicketData(source.data),
          })
        : () => {},
    );
  }, [ready, queryClient]);

  if (!data) {
    return error ? (
      <div role="alert" className="grid justify-items-start gap-2 text-sm">
        <p>The board did not load.</p>
        <button type="button" className="min-h-11 underline md:min-h-0" onClick={() => refetch()}>
          Try again
        </button>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">Loading the board.</p>
    );
  }

  return (
    <div className="grid gap-3">
      {isFiltered(filters) && data.length === 0 && !isPlaceholderData && (
        <p role="status" className="text-sm text-muted-foreground">
          No tickets match these filters.
        </p>
      )}
      <div
        ref={scroller}
        data-testid="board-scroller"
        aria-busy={isPlaceholderData}
        className={cn(
          "-mx-4 flex scroll-px-4 gap-3 overflow-x-auto px-4 pb-4 transition-opacity aria-busy:opacity-60 md:mx-0 md:snap-none md:px-0",
          // Snapping would jump a whole Status at a time while a Ticket is carried to the edge.
          holding ? "snap-none" : "snap-x snap-mandatory",
        )}
      >
        {ticketStatuses.map((status) => (
          <StatusLane key={status} status={status} tickets={byStatus[status]} />
        ))}
      </div>
    </div>
  );
}
