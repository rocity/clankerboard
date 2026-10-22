import { createApiKeyInput } from "@agentkanban/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { SetupSnippets } from "@/components/agents/setup-snippets";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage, unwrap } from "@/lib/api";
import { configQuery } from "@/lib/queries";

type Props = {
  agent: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Creates a key and shows it. The key lives only in this dialog's state: it is
 * not put in the query cache, and closing the dialog forgets it for good. While
 * the key is on screen only Done and the close button close the dialog.
 */
export function CreateKeyDialog({ agent, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const config = useQuery(configQuery);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createApiKeyInput.safeParse({
      label: new FormData(event.currentTarget).get("label"),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a label.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await unwrap(
        api.agents[":agentId"].keys.$post({ param: { agentId: agent.id }, json: parsed.data }),
      );
      setApiKey(created.secret);
      await queryClient.invalidateQueries({ queryKey: ["agents"] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setApiKey(null);
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        // The key is shown once. An outside click or Escape must not throw it away;
        // only Done (or the close button) does.
        onInteractOutside={(event) => {
          if (apiKey !== null) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (apiKey !== null) event.preventDefault();
        }}
      >
        {apiKey === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Create key</DialogTitle>
              <DialogDescription>
                For {agent.name}. Name it after where it will run.
              </DialogDescription>
            </DialogHeader>
            <form className="grid gap-4" onSubmit={submit}>
              <div className="grid gap-2">
                <Label htmlFor="key-label">Label</Label>
                <Input
                  id="key-label"
                  name="label"
                  placeholder="Laptop"
                  autoComplete="off"
                  required
                  className="h-11 text-base md:text-sm"
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="h-11" disabled={busy}>
                Create key
              </Button>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Copy your key now</DialogTitle>
              <DialogDescription>It is shown once and cannot be found again.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="api-key">API key</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="api-key"
                  readOnly
                  value={apiKey}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-11 min-w-0 font-mono text-base md:h-9 md:text-xs"
                />
                <CopyButton
                  text={apiKey}
                  label="Copy key"
                  variant="default"
                  className="h-11 md:h-9"
                />
              </div>
            </div>
            {config.data ? (
              <SetupSnippets publicUrl={config.data.publicUrl} apiKey={apiKey} />
            ) : (
              <p role="status" className="text-sm text-muted-foreground">
                {config.isError ? "Could not load the setup steps." : "Loading setup steps."}
              </p>
            )}
            <Button type="button" variant="outline" className="h-11" onClick={() => close(false)}>
              Done
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
