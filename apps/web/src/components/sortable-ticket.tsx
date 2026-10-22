import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TicketSummary } from "@/components/ticket-summary";
import type { TicketData } from "@/lib/board";
import { cn } from "@/lib/utils";

/**
 * A Ticket in a Status that can be picked up. The whole Ticket is the handle,
 * so there is no extra control to hit on a phone: a long press picks it up
 * there, a swipe still scrolls. While it is held, this place shows a faded copy
 * and the board's drag overlay carries the Ticket itself.
 */
export function SortableTicket({ ticket }: { ticket: TicketData }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.key,
    // Keep the list semantics: a button role would hide the Ticket's own content from a screen reader.
    attributes: { role: "listitem", roleDescription: "draggable Ticket" },
  });

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "cursor-grab touch-manipulation rounded-lg outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-[3px] focus-visible:ring-ring/50",
        isDragging && "opacity-40",
      )}
    >
      <TicketSummary ticket={ticket} />
    </li>
  );
}
