import { canManageTeams } from "@clankerboard/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, UsersRound } from "lucide-react";
import { CreateTeamButton } from "@/components/teams/create-team-button";
import { Badge } from "@/components/ui/badge";
import { errorMessage } from "@/lib/api";
import { memberCountLabel, teamsQuery } from "@/lib/teams";

export const Route = createFileRoute("/$companySlug/teams/")({
  component: TeamsPage,
});

function TeamsPage() {
  const { company } = Route.useRouteContext();
  const { companySlug } = Route.useParams();
  const teams = useQuery({ ...teamsQuery, staleTime: 0 });

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
          <p className="text-sm text-muted-foreground">
            How {company.name} is organized, and who is on each Team.
          </p>
        </div>
        {canManageTeams(company.role) && <CreateTeamButton />}
      </div>

      {teams.error && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(teams.error)}
        </p>
      )}
      {teams.isPending && <p className="text-sm text-muted-foreground">Loading teams.</p>}
      {teams.data && teams.data.length === 0 && (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {canManageTeams(company.role) ? "No teams yet. Create the first one." : "No teams yet."}
        </p>
      )}
      {teams.data && teams.data.length > 0 && (
        <ul aria-label="Teams" className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          {teams.data.map((team) => (
            <li key={team.id}>
              <Link
                to="/$companySlug/teams/$teamId"
                params={{ companySlug, teamId: team.id }}
                className="flex h-full min-h-11 items-center gap-3 rounded-xl border bg-card p-4 shadow-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-secondary dark:hover:bg-accent"
              >
                <span className="grid min-w-0 flex-1 gap-1.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 text-base font-semibold [overflow-wrap:anywhere]">
                      {team.name}
                    </span>
                    {team.myRole === "lead" && <Badge variant="secondary">You lead</Badge>}
                    {team.myRole === "member" && <Badge variant="outline">Your team</Badge>}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <UsersRound className="size-3.5 shrink-0" aria-hidden />
                    {memberCountLabel(team.memberCount)}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
