import type { TicketType } from "@agentkanban/shared";
import { Archive, BookOpen, Bot, Bug, CircleCheck, Lock, type LucideIcon, Zap } from "lucide-react";
import { ProgressBar } from "@/components/progress-bar";
import type { TicketData } from "@/lib/board";
import { cn } from "@/lib/utils";

const typeIcons: Record<TicketType, { icon: LucideIcon; label: string }> = {
  epic: { icon: Zap, label: "Epic" },
  story: { icon: BookOpen, label: "Story" },
  task: { icon: CircleCheck, label: "Task" },
  bug: { icon: Bug, label: "Bug" },
};

export function TypeIcon({ type, className }: { type: TicketType; className?: string }) {
  const { icon: Icon, label } = typeIcons[type];
  return <Icon role="img" aria-label={label} className={cn("size-3.5 shrink-0", className)} />;
}

function initials(name: string) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]);
  return letters.join("").toUpperCase() || "?";
}

/** Only these priorities are worth a badge. Low and medium are the quiet default. */
const loudPriorities = {
  high: {
    label: "High",
    className: "bg-orange-500/15 text-orange-800 dark:bg-orange-400/20 dark:text-orange-200",
  },
  urgent: {
    label: "Urgent",
    className: "bg-destructive/15 text-destructive dark:bg-destructive/25",
  },
} as const;

function Assignee({ assignee }: { assignee: NonNullable<TicketData["assignee"]> }) {
  const name = assignee.revoked ? `${assignee.name} (revoked)` : assignee.name;
  if (assignee.type === "agent") {
    return (
      <span
        data-testid="assignee"
        className="flex min-w-0 max-w-[65%] items-center gap-1.5 rounded-full bg-primary/10 py-1 pr-2.5 pl-2 text-xs font-medium text-primary"
      >
        <Bot role="img" aria-label="Agent" className="size-4 shrink-0" />
        <span className="truncate">{name}</span>
      </span>
    );
  }
  return (
    <span
      data-testid="assignee"
      className="flex min-w-0 max-w-[65%] items-center gap-1.5 text-xs text-muted-foreground"
    >
      <span
        aria-hidden
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-medium text-secondary-foreground"
      >
        {initials(assignee.name)}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * Says a Ticket can't start yet. Outlined, unlike the filled priority badges, so
 * the two never read as one scale. The label and the hover text count the open
 * blockers.
 */
function BlockedMarker({ count }: { count: number }) {
  const label = `Blocked by ${count} ${count === 1 ? "ticket" : "tickets"}`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="flex shrink-0 items-center gap-1 rounded-full border border-amber-600/60 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-300/60 dark:text-amber-200"
    >
      <Lock aria-hidden className="size-3" />
      Blocked
    </span>
  );
}

/**
 * A Ticket on the board. A pure function of the Ticket: the title leads on its
 * own line, the Ticket Key and Type are a quiet identifier above it, Blocked
 * and priority (only high or urgent) sit beside them, the Estimate shows as a
 * quiet "3 pts" only when set, and the Assignee holds the bottom right
 * corner, with a bot icon for an Agent. Progress, when reported, is a thin bar
 * along the bottom. It has no behavior of its own, so the drag handle and the
 * link to the detail panel wrap it.
 */
export function TicketSummary({ ticket }: { ticket: TicketData }) {
  const loud = ticket.priority === "high" || ticket.priority === "urgent" ? ticket.priority : null;
  const archived = ticket.archivedAt !== null;
  // Zero is a size, so only blank (null) hides the badge.
  const sized = ticket.estimate !== null;

  return (
    <article
      aria-label={ticket.title}
      data-archived={archived || undefined}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border bg-card p-3 text-card-foreground shadow-sm dark:bg-secondary",
        // An archived Ticket is flat and dashed, so it reads as set aside.
        archived && "border-dashed bg-transparent shadow-none dark:bg-transparent",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
          <TypeIcon type={ticket.type} />
          <span className="font-mono">{ticket.key}</span>
        </div>
        {(archived || ticket.blocked || loud || sized) && (
          <div className="ml-auto flex items-center gap-1.5">
            {archived && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                <Archive aria-hidden className="size-3" />
                Archived
              </span>
            )}
            {ticket.blocked && <BlockedMarker count={ticket.blockedByCount} />}
            {loud && (
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                  loudPriorities[loud].className,
                )}
              >
                {loudPriorities[loud].label}
              </span>
            )}
            {sized && (
              <span
                data-testid="estimate"
                className="shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap text-muted-foreground tabular-nums"
              >
                {ticket.estimate} pts
              </span>
            )}
          </div>
        )}
      </div>
      <h3 className="text-base leading-snug font-semibold [overflow-wrap:anywhere] md:text-sm">
        {ticket.title}
      </h3>
      {(ticket.parent || ticket.assignee) && (
        <div className="flex items-center justify-between gap-2">
          {ticket.parent ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
              <TypeIcon type={ticket.parent.type} />
              <span className="shrink-0 font-mono">{ticket.parent.key}</span>
              <span className="truncate">{ticket.parent.title}</span>
            </div>
          ) : (
            <span />
          )}
          {ticket.assignee && <Assignee assignee={ticket.assignee} />}
        </div>
      )}
      {ticket.progress !== null && <ProgressBar value={ticket.progress} />}
    </article>
  );
}
