import { type CompanyRole, canInviteToTeam } from "@agentkanban/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { InviteForm } from "@/components/invite-form";
import { InviteLinkPanel, type IssuedInvite } from "@/components/invite-link-panel";
import { PendingInvites } from "@/components/pending-invites";
import { invitesQuery, rolesWhere } from "@/lib/members";

type Props = {
  teamId: string;
  teamName: string;
  /** The signed-in User's Company Role, and whether they lead this Team. */
  role: CompanyRole;
  leadsTeam: boolean;
};

/**
 * Invites a new email straight onto a Team, and lists this Team's pending Invites. Owners and
 * admins get every Role they may grant. A lead brings Users in as plain members only (ADR-0006).
 */
export function TeamInvites({ teamId, teamName, role, leadsTeam }: Props) {
  // The server answers owners and admins with every Invite and a lead with their Teams' only.
  const invites = useQuery({ ...invitesQuery, staleTime: 0 });
  const [issued, setIssued] = useState<IssuedInvite | null>(null);
  const roles = rolesWhere((r) => canInviteToTeam(role, r, leadsTeam));
  const pending = (invites.data ?? []).filter((invite) => invite.teamId === teamId);

  return (
    <section aria-labelledby="team-invite-heading" className="grid gap-3">
      <h2 id="team-invite-heading" className="text-lg font-medium">
        Invite someone to {teamName}
      </h2>
      <InviteForm roles={roles} teamId={teamId} onIssued={setIssued} />
      {issued && <InviteLinkPanel issued={issued} onDone={() => setIssued(null)} />}
      {pending.length > 0 && (
        <PendingInvites invites={pending} role={role} leadsTeam={leadsTeam} onIssued={setIssued} />
      )}
    </section>
  );
}
