import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { restoreTicketMutation } from "@/lib/tickets";

/** Brings an archived Ticket back to the live board. Sits under the Ticket, not inside it. */
export function RestoreTicketButton({ ticketKey, title }: { ticketKey: string; title: string }) {
  const queryClient = useQueryClient();
  const restore = useMutation(restoreTicketMutation(queryClient));

  return (
    <div className="grid gap-1">
      <Button
        type="button"
        variant="outline"
        disabled={restore.isPending}
        aria-label={`Restore ${title}`}
        onClick={() => restore.mutate(ticketKey)}
        className="h-11 w-full md:h-8"
      >
        <ArchiveRestore aria-hidden />
        Restore
      </Button>
      {restore.error && (
        <p role="alert" className="text-xs text-destructive">
          {errorMessage(restore.error)}
        </p>
      )}
    </div>
  );
}
