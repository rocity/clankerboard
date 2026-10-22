import { createProjectInput } from "@clankerboard/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { api, errorMessage, unwrap } from "@/lib/api";
import { projectKeys, teamsQuery } from "@/lib/projects";

type Props = {
  companySlug: string;
};

/** The button and dialog that create a Project, then open its board. */
export function CreateProjectDialog({ companySlug }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: teams = [] } = useQuery(teamsQuery);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setKey("");
      setError(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = createProjectInput.safeParse({
      name: form.get("name"),
      key,
      teamId: String(form.get("team") ?? "") || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { project } = await unwrap(api.projects.$post({ json: parsed.data }));
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      reset(false);
      await navigate({
        to: "/$companySlug/projects/$projectKey",
        params: { companySlug, projectKey: project.key },
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button className="h-11 md:h-9">
          <Plus />
          Create project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            The Project Key starts every Ticket Key, like CB-42.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <div className="grid gap-2">
            <Label htmlFor="project-name">Name</Label>
            <Input id="project-name" name="name" autoComplete="off" className="h-11 md:h-9" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="project-key">Project Key</Label>
            <Input
              id="project-key"
              value={key}
              maxLength={10}
              autoComplete="off"
              autoCapitalize="characters"
              className="h-11 font-mono md:h-9"
              onChange={(event) => setKey(event.target.value.toUpperCase())}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="project-team">Team</Label>
            <NativeSelect id="project-team" name="team" defaultValue="">
              <option value="">No team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="h-11" disabled={busy}>
            Create project
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
