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
  const { data, error, refetch, isPlaceholderData } = useQuery({
    ...ticketsQuery(projectKey, filters),
    // While a new filter loads, keep showing the last view of this Project instead of a blank.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === projectKey ? previous : undefined,
  });

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

  const filtered = filters !== undefined && Object.values(filters).some((v) => v !== undefined);
  const byStatus = groupByStatus(data);
  return (
    <div className="grid gap-3">
      {filtered && data.length === 0 && !isPlaceholderData && (
        <p role="status" className="text-sm text-muted-foreground">
          No tickets match these filters.
        </p>
      )}
      <div
        data-testid="board-scroller"
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 items-start gap-3 overflow-x-auto px-4 pb-4 transition-opacity aria-busy:opacity-60 md:mx-0 md:snap-none md:px-0"
        aria-busy={isPlaceholderData}
      >
        {ticketStatuses.map((status) => (
          <StatusLane key={status} status={status} tickets={byStatus[status]} />
        ))}
      </div>
    </div>
  );
}
