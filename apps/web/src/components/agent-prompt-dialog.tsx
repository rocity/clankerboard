import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { agentPrompt } from "@/lib/agent-setup";
import { configQuery } from "@/lib/queries";

type Props = {
  companySlug: string;
  projectKey: string;
  projectName: string;
};

/** The button and dialog with a prompt that sets up Claude Code to work this Project's Tickets. */
export function AgentPromptDialog({ companySlug, projectKey, projectName }: Props) {
  const config = useQuery(configQuery);
  const prompt =
    config.data &&
    agentPrompt({ publicUrl: config.data.publicUrl, companySlug, projectKey, projectName });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-11 md:h-9">
          <Bot />
          Agent prompt
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Agent prompt</DialogTitle>
          <DialogDescription>
            Paste it into Claude Code. It asks you for an API Key the first time.
          </DialogDescription>
        </DialogHeader>
        {prompt ? (
          <>
            <pre className="max-h-[50dvh] overflow-y-auto rounded-md border bg-muted p-3 font-mono text-xs break-words whitespace-pre-wrap">
              {prompt}
            </pre>
            <CopyButton
              text={prompt}
              label="Copy prompt"
              variant="default"
              className="h-11 md:h-9"
            />
          </>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {config.isError ? "Could not load the prompt." : "Loading the prompt."}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
