import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useStreamStatus } from "@/lib/live-stream";

/** A short drop reconnects before anyone would notice, so the notice waits. */
const graceMs = 2000;

/**
 * Says so when the board has stopped following live changes. Quiet on purpose:
 * nothing shows while the stream is live or only blinked, a small pill shows
 * while it reconnects by itself, and a Reload button shows when it will not
 * (the session now belongs to another Company).
 */
export function StreamNotice() {
  const status = useStreamStatus();
  const [late, setLate] = useState(false);

  useEffect(() => {
    setLate(false);
    if (status === "live") return;
    const timer = setTimeout(() => setLate(true), graceMs);
    return () => clearTimeout(timer);
  }, [status]);

  if (status === "live" || (!late && status !== "elsewhere")) return null;

  return (
    <div
      role="status"
      data-testid="stream-notice"
      className="fixed inset-x-4 bottom-4 z-40 mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border bg-popover py-1.5 pr-2 pl-3 text-sm text-popover-foreground shadow-md"
    >
      <WifiOff className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      {status === "elsewhere" ? (
        <>
          <span>Live updates stopped. This tab is on another company.</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-full"
            onClick={() => location.reload()}
          >
            Reload
          </Button>
        </>
      ) : (
        <span className="pr-1">Connection lost. Retrying.</span>
      )}
    </div>
  );
}
