import { updateTicketInput } from "@clankerboard/shared";
import { Pencil } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";

type EditState = {
  editing: boolean;
  draft: string;
  error: string | null;
  busy: boolean;
  setDraft: (value: string) => void;
  start: () => void;
  cancel: () => void;
  save: () => Promise<void>;
};

/** Edit-in-place state for one text field: a draft, a validation or server error, a busy flag. */
function useEdit(
  field: "title" | "description",
  current: string,
  onSave: (value: string) => Promise<unknown>,
): EditState {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return {
    editing,
    draft,
    error,
    busy,
    setDraft,
    start: () => {
      setDraft(current);
      setError(null);
      setEditing(true);
    },
    cancel: () => setEditing(false),
    save: async () => {
      // The shared schema carries the server's own messages for an empty or too long value.
      const parsed = updateTicketInput.shape[field].safeParse(draft);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Check the text and try again.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        if (parsed.data !== current) await onSave(parsed.data ?? "");
        setEditing(false);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
  };
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-11 shrink-0 text-muted-foreground md:size-9"
      aria-label={label}
      onClick={onClick}
    >
      <Pencil />
    </Button>
  );
}

function SaveCancel({ edit }: { edit: EditState }) {
  return (
    <div className="flex gap-2">
      <Button type="submit" className="h-11 md:h-9" disabled={edit.busy}>
        Save
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-11 md:h-9"
        onClick={edit.cancel}
        disabled={edit.busy}
      >
        Cancel
      </Button>
    </div>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

function EditForm({ edit, children }: { edit: EditState; children: ReactNode }) {
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void edit.save();
      }}
    >
      {children}
      <ErrorLine message={edit.error} />
      <SaveCancel edit={edit} />
    </form>
  );
}

type TextProps = {
  value: string;
  onSave: (value: string) => Promise<unknown>;
};

export function EditableTitle({ value, onSave }: TextProps) {
  const edit = useEdit("title", value, onSave);

  if (edit.editing) {
    return (
      <EditForm edit={edit}>
        <Input
          aria-label="Title"
          value={edit.draft}
          autoFocus
          autoComplete="off"
          className="h-11 text-base md:h-9"
          onChange={(event) => edit.setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") edit.cancel();
          }}
        />
      </EditForm>
    );
  }
  return (
    <div className="flex items-start justify-between gap-2">
      <h2 className="min-w-0 py-2 text-xl leading-snug font-semibold [overflow-wrap:anywhere]">
        {value}
      </h2>
      <EditButton label="Edit title" onClick={edit.start} />
    </div>
  );
}

export function EditableDescription({ value, onSave }: TextProps) {
  const edit = useEdit("description", value, onSave);

  return (
    <section aria-labelledby="description-heading" className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id="description-heading" className="text-sm font-semibold">
          Description
        </h3>
        {!edit.editing && <EditButton label="Edit description" onClick={edit.start} />}
      </div>
      {edit.editing ? (
        <EditForm edit={edit}>
          <MarkdownEditor
            label="Description"
            value={edit.draft}
            onChange={edit.setDraft}
            placeholder="Describe the work. Markdown works."
          />
        </EditForm>
      ) : value.trim() ? (
        <Markdown source={value} />
      ) : (
        <p className="text-sm text-muted-foreground">No description.</p>
      )}
    </section>
  );
}
