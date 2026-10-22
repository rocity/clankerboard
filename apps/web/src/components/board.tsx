import { ticketStatuses } from "@clankerboard/shared";
import { useQuery } from "@tanstack/react-query";
import { StatusLane } from "@/components/status-lane";
import { groupByStatus } from "@/lib/board";
import { type BoardFilters, ticketsQuery } from "@/lib/tickets";

type Props = {
  projectKey: string;
  filters?: BoardFilters;
};

/** The Board of one Project: a lane per Status, each in rank order. */
export function Board({ projectKey, filters }: Props) {
  const { data, error, refetch } = useQuery(ticketsQuery(projectKey, filters));

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

  const byStatus = groupByStatus(data);
  return (
    <div
      data-testid="board-scroller"
      className="-mx-4 flex snap-x snap-mandatory scroll-px-4 items-start gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:snap-none md:px-0"
    >
      {ticketStatuses.map((status) => (
        <StatusLane key={status} status={status} tickets={byStatus[status]} />
      ))}
    </div>
  );
}
