import { type CompanyRole, canChangeRole, canRemoveMember } from "@clankerboard/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserMinus } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { api, errorMessage, unwrap } from "@/lib/api";
import { membersQuery, roleLabel, rolesWhere } from "@/lib/members";

export type Member = {
  userId: string;
  name: string;
  email: string;
  role: CompanyRole;
};

type Props = {
  members: Member[];
  /** The signed-in User's id and Role in this Company. */
  me: { userId: string; role: CompanyRole };
};

export function MemberList({ members, me }: Props) {
  return (
    <ul className="divide-y rounded-xl border bg-card text-card-foreground shadow-sm">
      {members.map((member) => (
        <MemberRow key={member.userId} member={member} me={me} />
      ))}
    </ul>
  );
}

function MemberRow({ member, me }: { member: Member; me: Props["me"] }) {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState(false);
  const isMe = member.userId === me.userId;

  const roles = rolesWhere((to) => to === member.role || canChangeRole(me.role, member.role, to));
  const mayChangeRole = !isMe && roles.length > 1;
  const mayRemove = !isMe && canRemoveMember(me.role, member.role);

  const changeRole = useMutation({
    mutationFn: (role: CompanyRole) =>
      unwrap(api.members[":userId"].$patch({ param: { userId: member.userId }, json: { role } })),
    onSettled: () => queryClient.invalidateQueries(membersQuery),
  });
  // Show the chosen Role while the change is on its way, and the old one again if it fails.
  const shownRole = changeRole.isPending ? changeRole.variables : member.role;

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
          <NativeSelect
            aria-label={`Role for ${member.name}`}
            className="sm:w-32"
            value={shownRole}
            disabled={changeRole.isPending}
            onChange={(event) => changeRole.mutate(event.target.value as CompanyRole)}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <Badge variant="secondary">{roleLabel(member.role)}</Badge>
        )}
        {mayRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto size-11 text-muted-foreground hover:text-destructive md:size-9 sm:ml-0"
            aria-label={`Remove ${member.name}`}
            onClick={() => setRemoving(true)}
          >
            <UserMinus />
          </Button>
        )}
      </div>

      {changeRole.error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {errorMessage(changeRole.error)}
        </p>
      )}

      <RemoveDialog member={member} open={removing} onOpenChange={setRemoving} />
    </li>
  );
}

function RemoveDialog({
  member,
  open,
  onOpenChange,
}: {
  member: Member;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => unwrap(api.members[":userId"].$delete({ param: { userId: member.userId } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries(membersQuery);
      onOpenChange(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) remove.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {member.name}?</DialogTitle>
          <DialogDescription>
            They lose access to this company, and their Agents are revoked.
          </DialogDescription>
        </DialogHeader>
        {remove.error && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(remove.error)}
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-9"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11 md:h-9"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
