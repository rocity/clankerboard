import { addTeamMemberInput } from "@clankerboard/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { api, errorMessage, unwrap } from "@/lib/api";
import { membersQuery } from "@/lib/members";
import { teamsQuery } from "@/lib/teams";

type Props = {
  teamId: string;
  /** User ids already on the Team. */
  onTeam: string[];
};

/** Adds someone who is already in the Company to the Team. */
export function AddTeamMember({ teamId, onTeam }: Props) {
  const queryClient = useQueryClient();
  const members = useQuery(membersQuery);
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const candidates = (members.data ?? []).filter((m) => !onTeam.includes(m.userId));

  const add = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.teams[":teamId"].members.$post({ param: { teamId }, json: { userId: id } })),
    onSuccess: () => queryClient.invalidateQueries(teamsQuery),
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = addTeamMemberInput.safeParse({ userId });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Pick a member.");
      return;
    }
    setError(null);
    try {
      await add.mutateAsync(parsed.data.userId);
      setUserId("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (members.data && candidates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Everyone in the company is on this team.</p>
    );
  }

  return (
    <form
      className="grid gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      onSubmit={submit}
    >
      <div className="grid gap-2">
        <Label htmlFor="add-team-member">Add a user</Label>
        <NativeSelect
          id="add-team-member"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
        >
          <option value="">Choose someone</option>
          {candidates.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" className="h-11 md:h-9" disabled={add.isPending}>
        Add to team
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      )}
    </form>
  );
}
