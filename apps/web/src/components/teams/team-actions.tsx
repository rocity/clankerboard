import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TeamNameDialog } from "@/components/teams/team-name-dialog";
import { Button } from "@/components/ui/button";
import { api, unwrap } from "@/lib/api";
import { projectKeys } from "@/lib/projects";
import { teamsQuery } from "@/lib/teams";

type Props = {
  companySlug: string;
  team: { id: string; name: string };
};

/** Rename and delete for one Team. Show it only to Users who may manage Teams. */
export function TeamActions({ companySlug, team }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const rename = useMutation({
    mutationFn: (name: string) =>
      unwrap(api.teams[":teamId"].$patch({ param: { teamId: team.id }, json: { name } })),
    onSuccess: () => queryClient.invalidateQueries(teamsQuery),
  });
  const remove = useMutation({
    mutationFn: () => unwrap(api.teams[":teamId"].$delete({ param: { teamId: team.id } })),
  });

  return (
    <div className="flex gap-2">
      <Button
        type="button"
        variant="outline"
        className="h-11 flex-1 sm:flex-none md:h-9"
        onClick={() => setRenaming(true)}
      >
        <Pencil />
        Rename team
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-11 flex-1 text-destructive hover:text-destructive sm:flex-none md:h-9"
        onClick={() => setDeleting(true)}
      >
        <Trash2 />
        Delete team
      </Button>

      <TeamNameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename team"
        submitLabel="Save"
        initialName={team.name}
        onSubmit={(name) => rename.mutateAsync(name)}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${team.name}?`}
        description="Its users stay in the company. Its projects stay, with no team. Pending invites for it are cancelled."
        confirmLabel="Delete team"
        onConfirm={async () => {
          await remove.mutateAsync();
          await navigate({ to: "/$companySlug/teams", params: { companySlug } });
          // Its Projects now have no Team.
          await queryClient.invalidateQueries({ queryKey: ["teams"] });
          await queryClient.invalidateQueries({ queryKey: projectKeys.all });
        }}
      />
    </div>
  );
}
