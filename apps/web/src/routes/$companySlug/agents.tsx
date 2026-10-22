import { canSeeAllAgents } from "@agentkanban/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { AgentCard } from "@/components/agents/agent-card";
import { AgentNameDialog } from "@/components/agents/agent-name-dialog";
import { Button } from "@/components/ui/button";
import { api, errorMessage, unwrap } from "@/lib/api";
import { agentsQuery, sessionQuery } from "@/lib/queries";

export const Route = createFileRoute("/$companySlug/agents")({
  component: AgentsPage,
});

function AgentsPage() {
  const { company } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: me } = useQuery(sessionQuery);
  const agents = useQuery(agentsQuery);
  const [creating, setCreating] = useState(false);
  const seesAll = canSeeAllAgents(company.role);

  // The Agents the viewer owns come first, then everyone else's, each by name.
  const sorted = [...(agents.data ?? [])].sort(
    (a, b) =>
      Number(b.owner.userId === me?.id) - Number(a.owner.userId === me?.id) ||
      a.name.localeCompare(b.name),
  );

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground">
            {seesAll
              ? "Every agent in this company. Create your own, or revoke any."
              : "Create an agent, then a key for it to connect Claude Code."}
          </p>
        </div>
        <Button className="h-11 shrink-0 md:h-9" onClick={() => setCreating(true)}>
          <Plus />
          New agent
        </Button>
      </div>

      {agents.isPending && <p className="text-sm text-muted-foreground">Loading agents.</p>}
      {agents.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(agents.error)}
        </p>
      )}
      {agents.data && sorted.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No agents yet.
        </p>
      )}
      {me && (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
          {sorted.map((agent) => (
            <li key={agent.id} className="min-w-0">
              <AgentCard agent={agent} viewer={{ userId: me.id, role: company.role }} />
            </li>
          ))}
        </ul>
      )}

      <AgentNameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New agent"
        description="Name it after the work it does or where it runs."
        submitLabel="Create agent"
        onSubmit={async (name) => {
          await unwrap(api.agents.$post({ json: { name } }));
          await queryClient.invalidateQueries({ queryKey: ["agents"] });
        }}
      />
    </div>
  );
}
