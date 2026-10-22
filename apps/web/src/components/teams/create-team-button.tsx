import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { TeamNameDialog } from "@/components/teams/team-name-dialog";
import { Button } from "@/components/ui/button";
import { api, unwrap } from "@/lib/api";
import { teamsQuery } from "@/lib/teams";

/** The button and dialog that create a Team. Show it only to Users who may manage Teams. */
export function CreateTeamButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const create = useMutation({
    mutationFn: (name: string) => unwrap(api.teams.$post({ json: { name } })),
    onSuccess: () => queryClient.invalidateQueries(teamsQuery),
  });

  return (
    <>
      <Button className="h-11 md:h-9" onClick={() => setOpen(true)}>
        <Plus />
        Create team
      </Button>
      <TeamNameDialog
        open={open}
        onOpenChange={setOpen}
        title="Create team"
        submitLabel="Create team"
        onSubmit={(name) => create.mutateAsync(name)}
      />
    </>
  );
}
