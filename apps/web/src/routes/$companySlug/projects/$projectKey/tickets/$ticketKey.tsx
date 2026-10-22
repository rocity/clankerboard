import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { TicketPanel } from "@/components/ticket-detail/panel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ApiError } from "@/lib/api";
import { ticketQuery } from "@/lib/ticket-detail";

// The Ticket detail. It nests under the board, so the board stays mounted
// behind the panel, and its URL carries the Ticket Key so it can be shared.
export const Route = createFileRoute("/$companySlug/projects/$projectKey/tickets/$ticketKey")({
  loader: async ({ context, params }) => {
    const ticket = await context.queryClient
      .fetchQuery(ticketQuery(params.ticketKey))
      .catch((error: unknown) => {
        throw error instanceof ApiError && error.status === 404 ? notFound() : error;
      });
    // A Ticket Key from another Project is not on this board.
    if (ticket.projectKey !== params.projectKey) throw notFound();
    // The API takes any letter case. The URL shows the Key as the Ticket spells it.
    if (ticket.key !== params.ticketKey) {
      throw redirect({
        to: "/$companySlug/projects/$projectKey/tickets/$ticketKey",
        params: { ...params, ticketKey: ticket.key },
        replace: true,
      });
    }
  },
  component: TicketDetail,
  notFoundComponent: TicketNotFound,
});

function TicketDetail() {
  const { companySlug, projectKey, ticketKey } = Route.useParams();
  const { company } = Route.useRouteContext();

  return (
    <TicketPanel
      companySlug={companySlug}
      projectKey={projectKey}
      ticketKey={ticketKey}
      role={company.role}
    />
  );
}

function TicketNotFound() {
  const { companySlug, projectKey } = Route.useParams();

  return (
    <Sheet open>
      <SheetContent aria-describedby={undefined} className="items-start gap-4 p-6">
        <SheetTitle className="text-xl font-semibold">Ticket not found</SheetTitle>
        <p className="text-sm text-muted-foreground">This project has no ticket with this key.</p>
        <Button asChild className="h-11">
          <Link to="/$companySlug/projects/$projectKey" params={{ companySlug, projectKey }}>
            Back to the board
          </Link>
        </Button>
      </SheetContent>
    </Sheet>
  );
}
