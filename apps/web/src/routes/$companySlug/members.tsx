import { canInvite, canListInvites } from "@agentkanban/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { InviteForm } from "@/components/invite-form";
import { InviteLinkPanel, type IssuedInvite } from "@/components/invite-link-panel";
import { MemberList } from "@/components/member-list";
import { PendingInvites } from "@/components/pending-invites";
import { errorMessage } from "@/lib/api";
import { invitesQuery, membersQuery, rolesWhere } from "@/lib/members";
import { sessionQuery } from "@/lib/queries";

export const Route = createFileRoute("/$companySlug/members")({
  component: MembersPage,
});

function MembersPage() {
  const { company } = Route.useRouteContext();
  const { data: me } = useQuery(sessionQuery);
  const members = useQuery(membersQuery);
  // Only owners and admins may list Invites. Team leads see theirs on the Team page.
  const manages = canListInvites(company.role);
  const invites = useQuery({ ...invitesQuery, enabled: manages });
  const [issued, setIssued] = useState<IssuedInvite | null>(null);
  const inviteRoles = rolesWhere((role) => canInvite(company.role, role));

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-8">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-sm text-muted-foreground">
          Everyone in {company.name}, and the Role each has.
        </p>
      </div>

      {manages && (
        <section aria-labelledby="invite-heading" className="grid gap-3">
          <h2 id="invite-heading" className="text-lg font-medium">
            Invite someone
          </h2>
          <InviteForm roles={inviteRoles} onIssued={setIssued} />
          {issued && <InviteLinkPanel issued={issued} onDone={() => setIssued(null)} />}
        </section>
      )}

      <section aria-label="Everyone in this company" className="grid gap-3">
        {members.isPending && <p className="text-sm text-muted-foreground">Loading.</p>}
        {members.error && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(members.error)}
          </p>
        )}
        {members.data && me && (
          <MemberList members={members.data} me={{ userId: me.id, role: company.role }} />
        )}
      </section>

      {manages && invites.data && invites.data.length > 0 && (
        <section aria-labelledby="pending-heading" className="grid gap-3">
          <h2 id="pending-heading" className="text-lg font-medium">
            Pending invites
          </h2>
          <PendingInvites invites={invites.data} role={company.role} onIssued={setIssued} />
        </section>
      )}
    </div>
  );
}
