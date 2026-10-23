import { type LabelColor, labelColors } from "@agentkanban/shared";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LabelChip } from "@/components/label-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { errorMessage } from "@/lib/api";
import { type LabelData, useLabelMutations } from "@/lib/labels";
import { capitalized } from "@/lib/timeline";

const ticketCount = (count: number) => `${count} ${count === 1 ? "ticket" : "tickets"}`;

type Props = {
  labels: LabelData[];
  /** Owners and admins get rename, recolor, and delete. Everyone else reads. */
  manages: boolean;
};

export function LabelList({ labels, manages }: Props) {
  return (
    <ul className="divide-y rounded-xl border bg-card text-card-foreground shadow-sm">
      {labels.map((label) => (
        <LabelRow key={label.id} label={label} manages={manages} />
      ))}
    </ul>
  );
}

function LabelRow({ label, manages }: { label: LabelData; manages: boolean }) {
  const mutations = useLabelMutations();
  const [deleting, setDeleting] = useState(false);
  const error = mutations.update.error;

  return (
    <li
      aria-label={label.name}
      className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
    >
      <div className="flex min-w-0 items-center gap-3">
        <LabelChip label={label} className="text-sm" />
        <span className="shrink-0 text-sm text-muted-foreground">
          {ticketCount(label.ticketCount)}
        </span>
      </div>

      {manages && (
        <div className="grid grid-cols-[minmax(0,1fr)_7.5rem_auto] items-center gap-2 sm:grid-cols-[12rem_7.5rem_auto]">
          {/* Keyed by name, so a saved or refused rename resets the field to what the server holds. */}
          <NameField
            key={label.name}
            label={label}
            onSave={(name) => mutations.update.mutateAsync({ id: label.id, name })}
          />
          <NativeSelect
            aria-label={`Color for ${label.name}`}
            value={
              mutations.update.isPending && mutations.update.variables.color
                ? mutations.update.variables.color
                : label.color
            }
            onChange={(event) =>
              mutations.update.mutate({ id: label.id, color: event.target.value as LabelColor })
            }
          >
            {labelColors.map((color) => (
              <option key={color} value={color}>
                {capitalized(color)}
              </option>
            ))}
          </NativeSelect>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 text-muted-foreground hover:text-destructive md:size-9"
            aria-label={`Delete label ${label.name}`}
            onClick={() => setDeleting(true)}
          >
            <Trash2 />
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {errorMessage(error)}
        </p>
      )}

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete the label ${label.name}?`}
        description={`${label.ticketCount === 0 ? "No live tickets have it." : `It comes off ${ticketCount(label.ticketCount)}.`} Archived tickets lose it too. This cannot be undone.`}
        confirmLabel="Delete label"
        onConfirm={() => mutations.remove.mutateAsync(label.id)}
      />
    </li>
  );
}

/** The Label's name, saved on Enter or when the field loses focus, and put back on Escape. */
function NameField({
  label,
  onSave,
}: {
  label: LabelData;
  onSave: (name: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(label.name);

  async function save() {
    const name = draft.trim();
    if (name === label.name) return;
    try {
      await onSave(name);
    } catch {
      // The row shows the server's message; the field goes back to the saved name.
      setDraft(label.name);
    }
  }

  return (
    <Input
      aria-label={`Name for ${label.name}`}
      value={draft}
      maxLength={30}
      autoComplete="off"
      className="h-11 md:h-9"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void save()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void save();
        }
        if (event.key === "Escape") setDraft(label.name);
      }}
    />
  );
}
