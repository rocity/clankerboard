import { type CompanyRole, createInviteInput } from "@clankerboard/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import type { IssuedInvite } from "@/components/invite-link-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { api, errorMessage, unwrap } from "@/lib/api";
import { invitesQuery, roleLabel } from "@/lib/members";

type Props = {
  /** The Roles the viewer may invite someone as. */
  roles: CompanyRole[];
  onIssued: (issued: IssuedInvite) => void;
};

/** Invites someone by email with a Role. The link comes back right away. */
export function InviteForm({ roles, onIssued }: Props) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<CompanyRole>(
    roles.includes("member") ? "member" : (roles[0] ?? "member"),
  );
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (json: { email: string; role: CompanyRole }) => unwrap(api.invites.$post({ json })),
    onSuccess: async (issued) => {
      onIssued(issued);
      await queryClient.invalidateQueries(invitesQuery);
    },
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = createInviteInput.safeParse({
      email: new FormData(form).get("email"),
      role,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid email address.");
      return;
    }
    setError(null);
    try {
      await create.mutateAsync({ email: parsed.data.email, role: parsed.data.role });
      form.reset();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form
      className="grid gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm md:grid-cols-[1fr_11rem_auto] md:items-end"
      onSubmit={submit}
    >
      <div className="grid gap-2">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          name="email"
          type="email"
          autoComplete="off"
          required
          className="h-11 text-base md:h-9 md:text-sm"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="invite-role">Role</Label>
        <NativeSelect
          id="invite-role"
          value={role}
          onChange={(event) => setRole(event.target.value as CompanyRole)}
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" className="h-11 md:h-9" disabled={create.isPending}>
        Create invite
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive md:col-span-3">
          {error}
        </p>
      )}
    </form>
  );
}
