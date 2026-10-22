import type { CompanyRole, TeamRole } from "@clankerboard/shared";
import { canManageTeamMembers, canSetTeamRole, teamRoles } from "@clankerboard/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserMinus } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { api, errorMessage, unwrap } from "@/lib/api";
import { teamRoleLabel, teamsQuery } from "@/lib/teams";

export type TeamMember = {
  userId: string;
  name: string;
  email: string;
  role: TeamRole;
};

type Props = {
  teamId: string;
  members: TeamMember[];
  /** The signed-in User's id, Company Role, and whether they lead this Team. */
  me: { userId: string; role: CompanyRole; leadsTeam: boolean };
};

export function TeamMembers({ teamId, members, me }: Props) {
  if (members.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        No one is on this team yet.
      </p>
    );
  }

  return (
    <ul
      aria-label="People"
      className="divide-y rounded-xl border bg-card text-card-foreground shadow-sm"
    >
      {members.map((member) => (
        <MemberRow key={member.userId} teamId={teamId} member={member} me={me} />
      ))}
    </ul>
  );
}

function MemberRow({
  teamId,
  member,
  me,
}: {
  teamId: string;
  member: TeamMember;
  me: Props["me"];
}) {
  const queryClient = useQueryClient();
  const isMe = member.userId === me.userId;
  const mayRemove = !isMe && canManageTeamMembers(me.role, me.leadsTeam);
  const mayChangeRole = !isMe && canSetTeamRole(me.role);
  const refresh = () => queryClient.invalidateQueries(teamsQuery);

  const changeRole = useMutation({
    mutationFn: (role: TeamRole) =>
      unwrap(
        api.teams[":teamId"].members[":userId"].$patch({
          param: { teamId, userId: member.userId },
          json: { role },
        }),
      ),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () =>
      unwrap(
        api.teams[":teamId"].members[":userId"].$delete({
          param: { teamId, userId: member.userId },
        }),
      ),
    onSuccess: refresh,
  });
  // Show the chosen Role while the change is on its way, and the old one again if it fails.
  const shownRole = changeRole.isPending ? changeRole.variables : member.role;
  const error = changeRole.error ?? remove.error;

  return (
    <li className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={member.name} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{member.name}</span>
            {isMe && <Badge variant="outline">You</Badge>}
          </div>
          <div className="truncate text-sm text-muted-foreground">{member.email}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {mayChangeRole ? (
          <div className="min-w-0 flex-1 sm:w-32 sm:flex-none">
            <NativeSelect
              aria-label={`Team role for ${member.name}`}
              value={shownRole}
              disabled={changeRole.isPending}
              onChange={(event) => changeRole.mutate(event.target.value as TeamRole)}
            >
              {teamRoles.map((role) => (
                <option key={role} value={role}>
                  {teamRoleLabel(role)}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : (
          <Badge variant={member.role === "lead" ? "secondary" : "outline"}>
            {teamRoleLabel(member.role)}
          </Badge>
        )}
        {mayRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto size-11 text-muted-foreground hover:text-destructive md:size-9 sm:ml-0"
            aria-label={`Remove ${member.name} from team`}
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            <UserMinus />
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {errorMessage(error)}
        </p>
      )}
    </li>
  );
}
