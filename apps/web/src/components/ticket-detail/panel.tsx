import { type CompanyRole, canHardDelete } from "@agentkanban/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Hand, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LabelsField } from "@/components/labels-field";
import { TypeIcon } from "@/components/ticket-summary";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ApiError, errorMessage } from "@/lib/api";
import { ticketQuery, useTicketMutations } from "@/lib/ticket-detail";
import { Children } from "./children";
import { CommentComposer } from "./comment-composer";
import { TicketFields } from "./fields";
import { Links } from "./links";
import { EditableDescription, EditableTitle } from "./text-fields";
import { Timeline } from "./timeline";

type Props = {
  companySlug: string;
  projectKey: string;
  ticketKey: string;
  role: CompanyRole;
};

/**
 * The Ticket detail: a panel over the board (the whole screen on a phone). It
 * reads the Ticket from the cache the live board keeps current, edits through
 * `useTicketMutations`, and closes by going back to the board's own URL.
 */
export function TicketPanel({ companySlug, projectKey, ticketKey, role }: Props) {
  const navigate = useNavigate();
  const { data: ticket, error: loadError } = useQuery({
    ...ticketQuery(ticketKey),
    refetchOnMount: false,
  });
  const mutations = useTicketMutations(ticketKey, projectKey);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // The board's filters are search params the panel inherits, so going back keeps them.
  const toBoard = useCallback(
    () =>
      navigate({
        from: "/$companySlug/projects/$projectKey/tickets/$ticketKey",
        to: "/$companySlug/projects/$projectKey",
        params: { companySlug, projectKey },
        search: (prev) => prev,
      }),
    [navigate, companySlug, projectKey],
  );

  // Someone deleted the Ticket while it was open (the live stream refetched it and it is gone).
  const gone = loadError instanceof ApiError && loadError.status === 404;
  useEffect(() => {
    if (!gone) return;
    toast.info(`${ticketKey} no longer exists.`);
    void toBoard();
  }, [gone, ticketKey, toBoard]);

  /** Runs one change. A refusal shows as a message and never throws, so a field can reset itself. */
  async function run(change: () => Promise<unknown>) {
    setError(null);
    try {
      await change();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!ticket) return null;
  const archived = ticket.archivedAt !== null;
  const canClaim = !archived && ticket.status !== "done" && ticket.assignee === null;

  return (
    <Sheet open onOpenChange={(open) => !open && void toBoard()}>
      <SheetContent
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // Focus the panel itself, not the Close button, so no ring shows on open.
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
        onEscapeKeyDown={(event) => {
          // Escape in a text field cancels the edit, not the whole panel.
          const target = event.target;
          if (target instanceof HTMLElement && target.closest("input, textarea")) {
            event.preventDefault();
          }
        }}
      >
        <SheetTitle className="sr-only">Ticket {ticket.key}</SheetTitle>
        <header className="flex items-center justify-between gap-2 border-b px-4 py-1 md:px-6 md:py-2">
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <TypeIcon type={ticket.type} />
            <span className="font-mono">{ticket.key}</span>
            {archived && (
              <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-foreground">
                Archived
              </span>
            )}
          </div>
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 md:size-9"
              aria-label="Close"
            >
              <X />
            </Button>
          </SheetClose>
        </header>

        <div className="grid flex-1 content-start gap-6 overflow-y-auto px-4 py-4 md:px-6">
          {error && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <EditableTitle
            value={ticket.title}
            onSave={(title) => mutations.update.mutateAsync({ title })}
          />

          <div className="flex flex-wrap gap-2">
            {canClaim && (
              <Button
                type="button"
                variant="outline"
                className="h-11 md:h-9"
                onClick={() => run(() => mutations.claim.mutateAsync())}
              >
                <Hand />
                Claim
              </Button>
            )}
            {archived ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 md:h-9"
                onClick={() => run(() => mutations.restore.mutateAsync())}
              >
                <ArchiveRestore />
                Restore
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="h-11 md:h-9"
                onClick={() => run(() => mutations.archive.mutateAsync())}
              >
                <Archive />
                Archive
              </Button>
            )}
            {canHardDelete(role) && (
              <Button
                type="button"
                variant="outline"
                className="h-11 text-destructive md:h-9"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 />
                Delete
              </Button>
            )}
          </div>

          <TicketFields
            ticket={ticket}
            onStatus={(status) => run(() => mutations.move.mutateAsync(status))}
            onType={(type) => run(() => mutations.update.mutateAsync({ type }))}
            onPriority={(priority) => run(() => mutations.update.mutateAsync({ priority }))}
            onEstimate={(estimate) => run(() => mutations.update.mutateAsync({ estimate }))}
            onProgress={(progress) => run(() => mutations.update.mutateAsync({ progress }))}
            onParent={(parentKey) => run(() => mutations.update.mutateAsync({ parentKey }))}
            onSprint={(sprint) => run(() => mutations.update.mutateAsync({ sprint }))}
            onAssignee={(assignee) => run(() => mutations.assign.mutateAsync(assignee))}
          />

          <LabelsField
            id="ticket-labels"
            value={ticket.labels.map((label) => label.name)}
            onChange={(labels) => run(() => mutations.update.mutateAsync({ labels }))}
          />

          <EditableDescription
            value={ticket.description}
            onSave={(description) => mutations.update.mutateAsync({ description })}
          />

          <Children companySlug={companySlug} projectKey={projectKey} ticketKey={ticket.key} />

          <Links companySlug={companySlug} projectKey={projectKey} ticket={ticket} />

          {/* Above the Timeline, so a new Comment shows right under where it was written. */}
          <section aria-labelledby="comment-heading" className="grid gap-2">
            <h3 id="comment-heading" className="text-sm font-semibold">
              Add a comment
            </h3>
            <CommentComposer onSubmit={(body) => mutations.comment.mutateAsync(body)} />
          </section>

          <Timeline ticketKey={ticket.key} />
        </div>

        <ConfirmDialog
          open={confirmingDelete}
          onOpenChange={setConfirmingDelete}
          title={`Delete ${ticket.key}?`}
          description="This removes the ticket with its comments and activity. Its children are kept. It cannot be undone."
          confirmLabel="Delete ticket"
          onConfirm={async () => {
            await mutations.remove.mutateAsync();
            await toBoard();
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
