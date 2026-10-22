import { canRevokeAgent } from "@clankerboard/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronDown, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { AgentNameDialog } from "@/components/agents/agent-name-dialog";
import { CreateKeyDialog } from "@/components/agents/create-key-dialog";
import { KeyList } from "@/components/agents/key-list";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, unwrap } from "@/lib/api";
import { exactTime, timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

type CompanyRole = Parameters<typeof canRevokeAgent>[0];

export type AgentRow = {
  id: string;
  name: string;
  owner: { userId: string; name: string; email: string };
  revokedAt: string | null;
  lastActiveAt: string | null;
};

type Props = {
  agent: AgentRow;
  viewer: { userId: string; role: CompanyRole };
};

export function AgentCard({ agent, viewer }: Props) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const mine = agent.owner.userId === viewer.userId;
  const revoked = agent.revokedAt !== null;
  const mayRevoke = canRevokeAgent(viewer.role, mine);
  const [keysOpen, setKeysOpen] = useState(mine && !revoked);
  const [renaming, setRenaming] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["agents"] });
  const mayRename = mine && !revoked;
  const mayRevokeNow = mayRevoke && !revoked;

  return (
    <article
      aria-labelledby={headingId}
      className={cn("rounded-lg border bg-card p-4 text-card-foreground", revoked && "bg-muted/40")}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground",
            revoked && "opacity-60",
          )}
        >
          <Bot className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2
              id={headingId}
              className={cn(
                "text-base font-medium break-words",
                revoked && "text-muted-foreground line-through",
              )}
            >
              {agent.name}
            </h2>
            {revoked && agent.revokedAt && (
              <Badge variant="destructive" title={exactTime(agent.revokedAt)}>
                Revoked
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {mine ? (
              <span>Owned by you</span>
            ) : (
              <>
                <span>Owned by {agent.owner.name}</span>
                <span className="block truncate">{agent.owner.email}</span>
              </>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {agent.lastActiveAt ? `Active ${timeAgo(agent.lastActiveAt)}` : "Never active"}
          </p>
        </div>
        {(mayRename || mayRevokeNow) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 md:size-9"
                aria-label="Agent actions"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {mayRename && (
                <DropdownMenuItem
                  className="min-h-11 md:min-h-0"
                  onSelect={() => setRenaming(true)}
                >
                  <Pencil />
                  Rename
                </DropdownMenuItem>
              )}
              {mayRevokeNow && (
                <DropdownMenuItem
                  variant="destructive"
                  className="min-h-11 md:min-h-0"
                  onSelect={() => setRevoking(true)}
                >
                  <Trash2 />
                  Revoke
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="mt-3 border-t pt-2">
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            className="-ml-3 h-11 px-3 md:h-9"
            aria-expanded={keysOpen}
            onClick={() => setKeysOpen(!keysOpen)}
          >
            <ChevronDown className={cn("transition-transform", !keysOpen && "-rotate-90")} />
            Keys
          </Button>
          {mine && !revoked && (
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => setCreatingKey(true)}
            >
              <Plus />
              Create key
            </Button>
          )}
        </div>
        {keysOpen && <KeyList agentId={agent.id} canRevoke={mayRevoke} />}
      </div>

      <AgentNameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename agent"
        submitLabel="Save"
        initialName={agent.name}
        onSubmit={async (name) => {
          await unwrap(
            api.agents[":agentId"].$patch({ param: { agentId: agent.id }, json: { name } }),
          );
          await refresh();
        }}
      />
      <ConfirmDialog
        open={revoking}
        onOpenChange={setRevoking}
        title={`Revoke ${agent.name}?`}
        description="It and all its keys stop working. This cannot be undone."
        confirmLabel="Revoke agent"
        onConfirm={async () => {
          await unwrap(api.agents[":agentId"].revoke.$post({ param: { agentId: agent.id } }));
          await refresh();
        }}
      />
      <CreateKeyDialog agent={agent} open={creatingKey} onOpenChange={setCreatingKey} />
    </article>
  );
}
