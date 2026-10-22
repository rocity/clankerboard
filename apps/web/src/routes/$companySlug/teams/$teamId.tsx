import { canManageTeamMembers, canManageTeams } from "@clankerboard/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { AddTeamMember } from "@/components/teams/add-team-member";
import { TeamActions } from "@/components/teams/team-actions";
import { TeamInvites } from "@/components/teams/team-invites";
import { TeamMembers } from "@/components/teams/team-members";
import { TeamProjects } from "@/components/teams/team-projects";
import { Button } from "@/components/ui/button";
import { ApiError, errorMessage } from "@/lib/api";
import { sessionQuery } from "@/lib/queries";
import { memberCountLabel, teamQuery } from "@/lib/teams";

export const Route = createFileRoute("/$companySlug/teams/$teamId")({
  component: TeamPage,
});

function TeamPage() {
  const { company } = Route.useRouteContext();
  const { companySlug, teamId } = Route.useParams();
  const team = useQuery(teamQuery(teamId));
  const { data: me } = useQuery(sessionQuery);
  const leadsTeam = team.data?.team.myRole === "lead";
  const manages = canManageTeamMembers(company.role, leadsTeam);

  if (team.error instanceof ApiError && team.error.status === 404) {
    return <TeamNotFound companySlug={companySlug} />;
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-8">
      <div className="grid gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-11 w-fit md:h-8">
          <Link to="/$companySlug/teams" params={{ companySlug }}>
            <ArrowLeft />
            All teams
          </Link>
        </Button>
        {team.error && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(team.error)}
          </p>
        )}
        {team.isPending && <p className="text-sm text-muted-foreground">Loading team.</p>}
        {team.data && (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="grid min-w-0 gap-1">
              <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
                {team.data.team.name}
              </h1>
              <p className="text-sm text-muted-foreground">
                {memberCountLabel(team.data.members.length)}
              </p>
            </div>
            {canManageTeams(company.role) && (
              <TeamActions companySlug={companySlug} team={team.data.team} />
            )}
          </div>
        )}
      </div>

      {team.data && (
        <>
          <section aria-labelledby="members-heading" className="grid gap-3">
            <h2 id="members-heading" className="text-lg font-medium">
              People
            </h2>
            {manages && (
              <AddTeamMember teamId={teamId} onTeam={team.data.members.map((m) => m.userId)} />
            )}
            {me && (
              <TeamMembers
                teamId={teamId}
                members={team.data.members}
                me={{ userId: me.id, role: company.role, leadsTeam }}
              />
            )}
          </section>

          {manages && (
            <TeamInvites
              teamId={teamId}
              teamName={team.data.team.name}
              role={company.role}
              leadsTeam={leadsTeam}
            />
          )}

          <section aria-labelledby="projects-heading" className="grid gap-3">
            <h2 id="projects-heading" className="text-lg font-medium">
              Projects
            </h2>
            <TeamProjects teamId={teamId} companySlug={companySlug} />
          </section>
        </>
      )}
    </div>
  );
}

function TeamNotFound({ companySlug }: { companySlug: string }) {
  return (
    <div className="mx-auto grid max-w-sm gap-4 py-12 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Team not found</h1>
      <p className="text-sm text-muted-foreground">This company has no team with this address.</p>
      <Button asChild className="h-11">
        <Link to="/$companySlug/teams" params={{ companySlug }}>
          All teams
        </Link>
      </Button>
    </div>
  );
}
