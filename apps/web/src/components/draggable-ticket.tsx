import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/attach-closest-edge";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/extract-closest-edge";
import type { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/types";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { TicketData } from "@/lib/board";
import { useHighlight } from "@/lib/live-highlight";
import { cn } from "@/lib/utils";

/** What a Ticket carries while it is dragged, and what it answers as a drop target. */
export type TicketDragData = { type: "ticket"; key: string };

export const isTicketData = (data: Record<string | symbol, unknown>): data is TicketDragData =>
  data.type === "ticket" && typeof data.key === "string";

/**
 * A Ticket that can be picked up. The whole Ticket is the handle, so there is
 * no extra control to hit on a phone. It is also a drop target for the other
 * Tickets: the closest edge, top or bottom, says which side of it a dropped
 * Ticket lands on, and a line shows it. An archived Ticket cannot be moved, so
 * it is not draggable.
 */
export function DraggableTicket({ ticket, children }: { ticket: TicketData; children: ReactNode }) {
  const ref = useRef<HTMLLIElement>(null);
  const [dragging, setDragging] = useState(false);
  const [edge, setEdge] = useState<Edge | null>(null);
  const archived = Boolean(ticket.archivedAt);
  const changed = useHighlight(ticket.key);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return combine(
      draggable({
        element,
        canDrag: () => !archived,
        getInitialData: (): TicketDragData => ({ type: "ticket", key: ticket.key }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element,
        // It accepts itself too, so a drop where it was is a drop on it, not on the Status behind it.
        canDrop: ({ source }) => isTicketData(source.data),
        getData: ({ input, element }) =>
          attachClosestEdge({ type: "ticket", key: ticket.key } satisfies TicketDragData, {
            input,
            element,
            allowedEdges: ["top", "bottom"],
          }),
        onDrag: ({ self, source }) =>
          setEdge(source.data.key === ticket.key ? null : extractClosestEdge(self.data)),
        onDragLeave: () => setEdge(null),
        onDrop: () => setEdge(null),
      }),
    );
  }, [ticket.key, archived]);

  return (
    <li
      ref={ref}
      data-ticket-key={ticket.key}
      data-dragging={dragging || undefined}
      // Padding, not a gap, so there is no dead strip between two Tickets that would drop at the end.
      className={cn(
        "relative grid gap-1.5 rounded-lg py-1 select-none [-webkit-touch-callout:none]",
        !archived && "cursor-grab",
        dragging && "opacity-40",
      )}
    >
      {children}
      {changed !== undefined && (
        // Someone else just changed this Ticket. The mark fades out (or, with reduced
        // motion, stays still) until the store clears it. A new change remounts it.
        <span
          key={changed}
          aria-hidden
          data-testid="live-change"
          className="pointer-events-none absolute inset-x-0 inset-y-1 rounded-lg bg-primary/10 ring-2 ring-primary/60 animate-live-change motion-reduce:animate-none"
        />
      )}
      {edge && (
        <span
          aria-hidden
          data-testid="drop-indicator"
          data-edge={edge}
          className={cn(
            "pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-ring",
            edge === "top" ? "top-0" : "bottom-0",
          )}
        />
      )}
    </li>
  );
}
