import { useState } from "react";
import { SprintTickets } from "@/components/sprints/sprint-tickets";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TicketData } from "@/lib/board";
import { type SprintData, sprintTotals } from "@/lib/sprints";

type Props = {
  companySlug: string;
  projectKey: string;
  /** Every Sprint of the Project, for the Tickets' selects. */
  sprints: SprintData[];
  /** The live Tickets in no Sprint, in board order. */
  tickets: TicketData[];
};

/**
 * The Tickets in no Sprint. Open ones (To Do, In Progress, Review) and Backlog
 * ones have a tab each, so neither buries the other, and Done ones show only on asking.
 */
export function NoSprintCard({ companySlug, projectKey, sprints, tickets }: Props) {
  const open = tickets.filter((t) => t.status !== "backlog" && t.status !== "done");
  const backlog = tickets.filter((t) => t.status === "backlog");
  const done = tickets.filter((t) => t.status === "done");
  // A Project's new Tickets start in Backlog, so it opens there while none is open.
  const [tab, setTab] = useState(() =>
    open.length === 0 && backlog.length > 0 ? "backlog" : "open",
  );
  const [showDone, setShowDone] = useState(false);
  const listProps = { companySlug, projectKey, sprints };

  return (
    <section
      aria-label="No sprint"
      className="rounded-xl border bg-card text-card-foreground shadow-sm"
    >
      <div className="grid gap-1 p-4">
        <h2 className="text-base font-semibold">No sprint</h2>
        <p className="text-sm text-muted-foreground">{sprintTotals(tickets)}</p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-0">
        <TabsList className="mx-4 mb-4">
          <TabsTrigger value="open">Open ({open.length})</TabsTrigger>
          <TabsTrigger value="backlog">Backlog ({backlog.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="open">
          <SprintTickets
            {...listProps}
            tickets={open}
            empty="No To Do, In Progress, or Review tickets are outside a sprint."
          />
        </TabsContent>
        <TabsContent value="backlog">
          <SprintTickets
            {...listProps}
            tickets={backlog}
            empty="No Backlog tickets are outside a sprint."
          />
        </TabsContent>
      </Tabs>

      {done.length > 0 && (
        <div className="border-t">
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            {showDone && <h3 className="text-sm font-medium">Done ({done.length})</h3>}
            <Button
              type="button"
              variant="ghost"
              className="ml-auto h-11 md:h-8"
              aria-expanded={showDone}
              onClick={() => setShowDone(!showDone)}
            >
              {showDone ? "Hide done tickets" : `Show done tickets (${done.length})`}
            </Button>
          </div>
          {showDone && <SprintTickets {...listProps} tickets={done} empty="" />}
        </div>
      )}
    </section>
  );
}
