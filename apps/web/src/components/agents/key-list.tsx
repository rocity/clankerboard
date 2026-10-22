import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage, unwrap } from "@/lib/api";
import { agentKeysQuery } from "@/lib/queries";
import { exactTime, timeAgo } from "@/lib/time";

type Key = {
  id: string;
  label: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type Props = {
  agentId: string;
  /** Whether the viewer may revoke keys: the Agent's owner, an owner, or an admin. */
  canRevoke: boolean;
};

export function KeyList({ agentId, canRevoke }: Props) {
  const keys = useQuery(agentKeysQuery(agentId));
  const [revoking, setRevoking] = useState<Key | null>(null);
  const queryClient = useQueryClient();

  if (keys.isPending) return <p className="py-2 text-sm text-muted-foreground">Loading keys.</p>;
  if (keys.isError) {
    return (
      <p role="alert" className="py-2 text-sm text-destructive">
        {errorMessage(keys.error)}
      </p>
    );
  }
  if (keys.data.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">No keys yet.</p>;
  }

  return (
    <>
      <ul className="divide-y">
        {keys.data.map((key) => (
          <li key={key.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className={key.revokedAt ? "text-muted-foreground line-through" : "font-medium"}
                >
                  <span className="break-all">{key.label}</span>
                </span>
                {key.revokedAt && (
                  <Badge variant="destructive" title={exactTime(key.revokedAt)}>
                    Revoked
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                <span className="font-mono">{key.prefix}</span>
                <span aria-hidden>...</span>
                <span aria-hidden> · </span>
                <span title={key.lastUsedAt ? exactTime(key.lastUsedAt) : undefined}>
                  {key.lastUsedAt ? `Used ${timeAgo(key.lastUsedAt)}` : "Never used"}
                </span>
              </p>
            </div>
            {canRevoke && !key.revokedAt && (
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0 md:h-8"
                aria-label={`Revoke key ${key.label}`}
                onClick={() => setRevoking(key)}
              >
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke key ${revoking?.label ?? ""}?`}
        description="Anything using this key stops working. This cannot be undone."
        confirmLabel="Revoke key"
        onConfirm={async () => {
          if (!revoking) return;
          await unwrap(
            api.agents[":agentId"].keys[":keyId"].revoke.$post({
              param: { agentId, keyId: revoking.id },
            }),
          );
          await queryClient.invalidateQueries({ queryKey: ["agents"] });
        }}
      />
    </>
  );
}
