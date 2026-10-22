import { statusLabels, type TicketStatus, ticketStatuses } from "@clankerboard/shared";
import {
  type Announcements,
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardCode,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  PointerSensor,
  type PointerSensorOptions,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type PointerEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StatusLane, statusDropId } from "@/components/status-lane";
import { TicketSummary } from "@/components/ticket-summary";
import { groupByStatus, type TicketData } from "@/lib/board";
import { moveTicket } from "@/lib/move-ticket";
import { type BoardFilters, isFiltered, ticketsQuery } from "@/lib/tickets";
import { useEdgeScroll } from "@/lib/use-edge-scroll";
import { cn } from "@/lib/utils";

type Props = {
  projectKey: string;
  filters?: BoardFilters;
};

/** The Ticket Keys of each Status, top to bottom: the order a drag edits while a Ticket is held. */
type Order = Record<TicketStatus, string[]>;

/**
 * The pointer sensor for a mouse or a pen. A finger is left to the touch
 * sensor, which waits for a long press, so a swipe still scrolls the board.
 */
class MouseAndPenSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: (
        { nativeEvent: event }: PointerEvent<Element>,
        { onActivation }: PointerSensorOptions,
      ) => {
        if (event.pointerType === "touch" || !event.isPrimary || event.button !== 0) return false;
        onActivation?.({ event });
        return true;
      },
    },
  ];
}

const dropStatus = (id: unknown): TicketStatus | undefined =>
  ticketStatuses.find((status) => statusDropId(status) === id);

function orderOf(byStatus: Record<TicketStatus, readonly TicketData[]>): Order {
  return Object.fromEntries(ticketStatuses.map((s) => [s, byStatus[s].map((t) => t.key)])) as Order;
}

function statusHolding(order: Order, key: unknown) {
  return ticketStatuses.find((status) => order[status].includes(String(key)));
}

/**
 * Arrow keys for a Ticket held with the keyboard: up and down step through the
 * Status, left and right go to the same place in the next Status. Returns where
 * the Ticket's top left corner should go, which is the corner of the Ticket (or
 * empty Status) it is stepping onto.
 */
function keyboardTarget(
  event: KeyboardEvent,
  { context: { active, droppableRects, over } }: Parameters<KeyboardCoordinateGetter>[1],
  order: Order | null,
) {
  const status = active && order && statusHolding(order, active.id);
  if (!status || !order) return;
  const lane = order[status];
  // Where the Ticket is drawn: it takes the place of the Ticket it is over.
  const overAt = over ? lane.indexOf(String(over.id)) : -1;
  const at = overAt >= 0 ? overAt : lane.indexOf(String(active.id));
  const sideways =
    event.code === KeyboardCode.Left ? -1 : event.code === KeyboardCode.Right ? 1 : 0;
  let targetId: string | undefined;
  if (sideways) {
    const next = ticketStatuses[ticketStatuses.indexOf(status) + sideways];
    if (!next) return;
    targetId = order[next][Math.min(at, order[next].length - 1)] ?? statusDropId(next);
  } else if (event.code === KeyboardCode.Up) {
    targetId = lane[at - 1];
  } else if (event.code === KeyboardCode.Down) {
    targetId = lane[at + 1];
  }
  const rect = targetId ? droppableRects.get(targetId) : undefined;
  if (!rect) return;
  event.preventDefault();
  return { x: rect.left, y: rect.top };
}

/** True when both orders hold the same Tickets in the same places. */
const sameOrder = (a: Order, b: Order) => ticketStatuses.every((s) => a[s].join() === b[s].join());

/**
 * The Board of one Project: a Status per column, each in rank order. A Ticket
 * can be dragged within a Status or to another one. While it is held, `held`
 * edits a copy of the order, and the drop turns that into one move (see
 * `moveTicket`), so the cache is touched once.
 */
export function Board({ projectKey, filters = {} }: Props) {
  const { data, error, refetch, isPlaceholderData } = useQuery({
    ...ticketsQuery(projectKey, filters),
    // While a new filter loads, keep showing the last view of this Project instead of a blank.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === projectKey ? previous : undefined,
  });
  const queryClient = useQueryClient();
  const [held, setHeld] = useState<Order | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const settling = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  // Counts drags, so the end of an old move cannot clear the order of a newer drag.
  const dragCount = useRef(0);
  const orderRef = useRef<Order | null>(null);

  const sensors = useSensors(
    // Moving 6px picks it up, so a click on a Ticket is still a click.
    useSensor(MouseAndPenSensor, { activationConstraint: { distance: 6 } }),
    // A quarter second of rest picks it up, and a finger that moves before that scrolls.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: (event, args) => keyboardTarget(event, args, orderRef.current),
    }),
  );

  const byKey = useMemo(() => new Map((data ?? []).map((t) => [t.key, t])), [data]);
  const byStatus = useMemo(() => groupByStatus(data ?? []), [data]);
  const order = held ?? orderOf(byStatus);
  orderRef.current = order;
  useEdgeScroll(scroller, activeKey !== null);

  // The drop writes to the cache, and the cache reaches this component a tick
  // later. Keeping the held order until then avoids a frame at the old place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the cache changes
  useLayoutEffect(() => {
    if (settling.current) {
      settling.current = false;
      setHeld(null);
    }
  }, [data]);

  if (!data) {
    return error ? (
      <div role="alert" className="grid justify-items-start gap-2 text-sm">
        <p>The board did not load.</p>
        <button type="button" className="underline" onClick={() => refetch()}>
          Try again
        </button>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">Loading the board.</p>
    );
  }

  // A drop lands in the Status under the pointer, then in the nearest Ticket of it.
  const collide: CollisionDetection = (args) => {
    const lanes = args.droppableContainers.filter((c) => dropStatus(c.id));
    const inside = args.pointerCoordinates
      ? pointerWithin({ ...args, droppableContainers: lanes })
      : [];
    const lane = (
      inside.length > 0 ? inside : closestCenter({ ...args, droppableContainers: lanes })
    )[0];
    const status = lane && dropStatus(lane.id);
    if (!lane || !status) return [];
    const inLane = orderRef.current?.[status] ?? [];
    const tickets = args.droppableContainers.filter((c) => inLane.includes(String(c.id)));
    return tickets.length > 0 ? closestCenter({ ...args, droppableContainers: tickets }) : [lane];
  };

  function dragStart({ active }: DragStartEvent) {
    settling.current = false;
    dragCount.current += 1;
    setActiveKey(String(active.id));
    setHeld(orderOf(byStatus));
  }

  // Crossing into another Status takes the Ticket there, at the place it is over.
  function dragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    setHeld((current) => {
      if (!current) return current;
      const from = statusHolding(current, active.id);
      const to = dropStatus(over.id) ?? statusHolding(current, over.id);
      if (!from || !to || from === to) return current;
      const target = current[to];
      let index = target.length;
      const overIndex = target.indexOf(String(over.id));
      if (overIndex >= 0) {
        const moved = active.rect.current.translated;
        const activeMiddle = moved ? moved.top + moved.height / 2 : 0;
        index = overIndex + (activeMiddle > over.rect.top + over.rect.height / 2 ? 1 : 0);
      }
      return {
        ...current,
        [from]: current[from].filter((key) => key !== String(active.id)),
        [to]: [...target.slice(0, index), String(active.id), ...target.slice(index)],
      };
    });
  }

  function dragEnd({ active, over }: DragEndEvent) {
    const key = String(active.id);
    setActiveKey(null);
    const current = orderRef.current;
    if (!current) return setHeld(null);
    const ticket = byKey.get(key);
    const status = statusHolding(current, key);
    if (!over || !ticket || !status) return setHeld(null);

    // Within one Status the Ticket takes the place of the one it is over.
    const lane = current[status];
    const overIndex = lane.indexOf(String(over.id));
    const dropped =
      overIndex >= 0 && String(over.id) !== key
        ? arrayMove(lane, lane.indexOf(key), overIndex)
        : lane;
    const final = { ...current, [status]: dropped };

    if (sameOrder(final, orderOf(byStatus))) return setHeld(null);
    const at = dropped.indexOf(key);
    // The server ranks between live Tickets, so an archived one is not a neighbour.
    const neighbour = (step: -1 | 1) => {
      for (let i = at + step; i >= 0 && i < dropped.length; i += step) {
        const next = byKey.get(dropped[i] as string);
        if (next && !next.archivedAt) return next;
      }
      return null;
    };
    const count = dragCount.current;
    settling.current = true;
    setHeld(final);
    void moveTicket(
      queryClient,
      ticket,
      { status, after: neighbour(-1), before: neighbour(1) },
      { filtered: isFiltered(filters) },
    ).then(() => {
      // Normally the layout effect has cleared it already.
      if (dragCount.current !== count) return;
      settling.current = false;
      setHeld(null);
    });
  }

  function dragCancel() {
    setActiveKey(null);
    setHeld(null);
  }

  const labelOf = (id: unknown) => {
    const status = dropStatus(id) ?? statusHolding(order, id);
    return status ? statusLabels[status] : "the board";
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Dragging ${active.id}.`,
    onDragOver: ({ active, over }) =>
      over ? `${active.id} is over ${labelOf(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over ? `Dropped ${active.id} in ${labelOf(over.id)}.` : `${active.id} was not moved.`,
    onDragCancel: ({ active }) => `Cancelled. ${active.id} was not moved.`,
  };

  const activeTicket = activeKey ? byKey.get(activeKey) : undefined;
  const receiving = activeKey ? statusHolding(order, activeKey) : undefined;

  return (
    <DndContext
      autoScroll={{ canScroll: (element) => element !== scroller.current }}
      sensors={sensors}
      collisionDetection={collide}
      onDragStart={dragStart}
      onDragOver={dragOver}
      onDragEnd={dragEnd}
      onDragCancel={dragCancel}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "To move a Ticket, focus it and press the spacebar. Use the arrow keys to choose a place, the spacebar to drop it, and escape to cancel.",
        },
      }}
    >
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
            // Snapping fights the scroll that carries a held Ticket to the next Status.
            activeKey ? "snap-none" : "snap-x snap-mandatory",
          )}
        >
          {ticketStatuses.map((status) => (
            <StatusLane
              key={status}
              status={status}
              receiving={receiving === status}
              tickets={order[status].flatMap((key) => byKey.get(key) ?? [])}
            />
          ))}
        </div>
      </div>
      <DragOverlay>
        {activeTicket && (
          <div data-testid="drag-overlay" className="rotate-1 cursor-grabbing shadow-xl">
            <TicketSummary ticket={activeTicket} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
