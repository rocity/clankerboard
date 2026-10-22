import { useQuery } from "@tanstack/react-query";
import { ActorName } from "@/components/actor-name";
import { Markdown } from "@/components/markdown";
import { actorsQuery } from "@/lib/actors";
import { timelineQuery } from "@/lib/ticket-detail";
import { exactTime, timeAgo } from "@/lib/time";
import { describeActivity } from "@/lib/timeline";

function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={exactTime(iso)} className="shrink-0 text-xs text-muted-foreground">
      {timeAgo(iso)}
    </time>
  );
}

/** The Ticket's Comments and Activity in the order they happened, each credited to its Actor. */
export function Timeline({ ticketKey }: { ticketKey: string }) {
  const { data: entries, error, refetch } = useQuery(timelineQuery(ticketKey));
  const { data: actors = [] } = useQuery(actorsQuery);

  // Assignee changes record only an Actor's type and id, so names come from the Actor list.
  const actorName = (ref: { type?: unknown; id?: unknown } | null | undefined) =>
    actors.find((a) => a.type === ref?.type && a.id === ref?.id)?.name ??
    (ref?.type === "agent" ? "an agent" : "someone");

  return (
    <section aria-labelledby="timeline-heading" className="grid gap-3">
      <h3 id="timeline-heading" className="text-sm font-semibold">
        Timeline
      </h3>
      {!entries ? (
        error ? (
          <div role="alert" className="grid justify-items-start gap-2 text-sm">
            <p>The timeline did not load.</p>
            <button
              type="button"
              className="min-h-11 underline md:min-h-0"
              onClick={() => refetch()}
            >
              Try again
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Loading the timeline.</p>
        )
      ) : (
        <ol className="grid gap-3">
          {entries.map((entry) =>
            entry.type === "comment" ? (
              <li
                key={`comment-${entry.id}`}
                data-kind="comment"
                className="grid min-w-0 gap-2 rounded-lg border bg-card p-3 text-card-foreground"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <ActorName actor={entry.author} labelled />
                  <When iso={entry.createdAt} />
                </div>
                <Markdown source={entry.body} />
              </li>
            ) : (
              <li
                key={`activity-${entry.id}`}
                data-kind="activity"
                className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 px-1 text-sm text-muted-foreground"
              >
                <ActorName actor={entry.actor} className="text-foreground" />
                <span className="[overflow-wrap:anywhere]">
                  {describeActivity(entry.kind, entry.payload, actorName)}
                </span>
                <When iso={entry.createdAt} />
              </li>
            ),
          )}
        </ol>
      )}
    </section>
  );
}
