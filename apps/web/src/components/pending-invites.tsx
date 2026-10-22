import { type CompanyRole, canInvite } from "@clankerboard/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCw, X } from "lucide-react";
import type { IssuedInvite } from "@/components/invite-link-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage, unwrap } from "@/lib/api";
import { invitesQuery, roleLabel } from "@/lib/members";

export type PendingInvite = {
  id: string;
  email: string;
  role: CompanyRole;
  teamName: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
};

type Props = {
  invites: PendingInvite[];
  /** The signed-in User's Role in this Company. */
  role: CompanyRole;
  /** Called with the new link after a resend. */
  onIssued: (issued: IssuedInvite) => void;
};

export function PendingInvites({ invites, role, onIssued }: Props) {
  return (
    <ul className="divide-y rounded-xl border bg-card text-card-foreground shadow-sm">
      {invites.map((invite) => (
        <InviteRow key={invite.id} invite={invite} role={role} onIssued={onIssued} />
      ))}
    </ul>
  );
}

const expiryDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function InviteRow({
  invite,
  role,
  onIssued,
}: {
  invite: PendingInvite;
  role: CompanyRole;
  onIssued: Props["onIssued"];
}) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries(invitesQuery);

  const resend = useMutation({
    mutationFn: () =>
      unwrap(api.invites[":inviteId"].resend.$post({ param: { inviteId: invite.id } })),
    onSuccess: async (issued) => {
      onIssued(issued);
      await refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: () =>
      unwrap(api.invites[":inviteId"].revoke.$post({ param: { inviteId: invite.id } })),
    onSuccess: refresh,
  });
  const error = resend.error ?? revoke.error;
  const mayManage = canInvite(role, invite.role);
  const expired = invite.status === "expired";

  return (
    <li className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="grid min-w-0 gap-1.5">
        <span className="truncate font-medium">{invite.email}</span>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{roleLabel(invite.role)}</Badge>
          {invite.teamName && <Badge variant="outline">{invite.teamName}</Badge>}
          {expired ? (
            <Badge variant="destructive">Expired</Badge>
          ) : (
            <span>Expires {expiryDate(invite.expiresAt)}</span>
          )}
        </div>
      </div>
      {mayManage && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1 sm:flex-none md:h-9"
            disabled={resend.isPending}
            onClick={() => resend.mutate()}
          >
            <RotateCw />
            Resend
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11 flex-1 text-muted-foreground hover:text-destructive sm:flex-none md:h-9"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate()}
          >
            <X />
            Revoke
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {errorMessage(error)}
        </p>
      )}
    </li>
  );
}
