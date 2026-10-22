import type { ReactNode } from "react";
import { CopyButton } from "@/components/copy-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addCommand, exportLine, mcpJson } from "@/lib/agent-setup";
import { cn } from "@/lib/utils";

/** `wrap` breaks long lines (a command or key). Without it, long lines scroll inside the box (JSON). */
function Snippet({ text, label, wrap }: { text: string; label: string; wrap?: boolean }) {
  return (
    <div className="grid gap-2">
      <pre
        className={cn(
          "rounded-md border bg-muted p-3 font-mono text-xs",
          wrap ? "break-all whitespace-pre-wrap" : "overflow-x-auto",
        )}
      >
        {text}
      </pre>
      <CopyButton text={text} label={label} className="h-11 md:h-9" />
    </div>
  );
}

function Step({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

type Props = {
  publicUrl: string;
  secret: string;
};

/** Ready-to-paste Claude Code setup for a new key, pointing at this server. */
export function SetupSnippets({ publicUrl, secret }: Props) {
  return (
    <Tabs defaultValue="command">
      <TabsList className="w-full">
        <TabsTrigger value="command" className="flex-1">
          Command
        </TabsTrigger>
        <TabsTrigger value="file" className="flex-1">
          .mcp.json
        </TabsTrigger>
      </TabsList>
      <TabsContent value="command" className="grid gap-3">
        <Step>Run this in your project.</Step>
        <Snippet text={addCommand(publicUrl, secret)} label="Copy command" wrap />
      </TabsContent>
      <TabsContent value="file" className="grid gap-3">
        <Step>Add this to .mcp.json in your project. It is safe to commit.</Step>
        <Snippet text={mcpJson(publicUrl)} label="Copy .mcp.json" />
        <Step>Then set the key where Claude Code runs.</Step>
        <Snippet text={exportLine(secret)} label="Copy export" wrap />
      </TabsContent>
    </Tabs>
  );
}
