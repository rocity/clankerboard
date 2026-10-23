import { cn } from "@/lib/utils";

/**
 * A Ticket's Progress as a thin bar with its percentage after it. It is an
 * accessible progress bar named like "40% done", so a screen reader hears the
 * same thing the bar shows.
 */
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const label = `${value}% done`;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      title={label}
      className={cn("flex items-center gap-2", className)}
    >
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/10">
        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
      <span aria-hidden className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {value}%
      </span>
    </div>
  );
}
