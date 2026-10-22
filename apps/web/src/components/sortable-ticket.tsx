import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";
import type { TicketData } from "@/lib/board";
import { cn } from "@/lib/utils";

/**
 * A Ticket in a Status that can be picked up. The whole Ticket is the handle,
 * so there is no extra control to hit on a phone: a long press picks it up
 * there, a swipe still scrolls. While it is held, this place shows a faded copy
 * and the board's drag overlay carries the Ticket itself. An archived Ticket
 * cannot be moved, so it stays put.
 */
export function SortableTicket({ ticket, children }: { ticket: TicketData; children: ReactNode }) {
  const archived = Boolean(ticket.archivedAt);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.key,
    disabled: archived,
    // Keep the list semantics: a button role would hide the Ticket's own content from a screen reader.
    attributes: { role: "listitem", roleDescription: "draggable Ticket" },
  });

  return (
    <li
      ref={setNodeRef}
      // A disabled Ticket drops dnd-kit's `aria-disabled`, which would also disable its Restore button.
      {...(archived ? {} : attributes)}
      {...listeners}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "grid gap-1.5 rounded-lg outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-[3px] focus-visible:ring-ring/50",
        !archived && "cursor-grab",
        isDragging && "opacity-40",
      )}
    >
      {children}
    </li>
  );
}
