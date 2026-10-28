import { statusLabels, type TicketStatus } from "@agentkanban/shared";
import { cn } from "@/lib/utils";

/** Each Status has its own tint, so a list of Tickets reads at a glance. Backlog stays quiet. */
const statusColors: Record<TicketStatus, string> = {
  backlog: "bg-foreground/10 text-muted-foreground",
  todo: "bg-blue-600/15 text-blue-800 dark:bg-blue-400/20 dark:text-blue-100",
  in_progress: "bg-amber-500/15 text-amber-800 dark:bg-amber-400/20 dark:text-amber-100",
  review: "bg-violet-600/15 text-violet-800 dark:bg-violet-400/20 dark:text-violet-100",
  done: "bg-green-600/15 text-green-800 dark:bg-green-400/20 dark:text-green-100",
};

export function StatusPill({ status, className }: { status: TicketStatus; className?: string }) {
  return (
    <span
      data-status={status}
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
        statusColors[status],
        className,
      )}
    >
      {statusLabels[status]}
    </span>
  );
}
