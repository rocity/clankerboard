import { useState } from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";

type Props = {
  onSubmit: (body: string) => Promise<unknown>;
};

/** Writes a Comment in Markdown, with a preview. The draft stays if the server refuses it. */
export function CommentComposer({ onSubmit }: Props) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(body.trim());
      setBody("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <MarkdownEditor
        label="Comment"
        value={body}
        onChange={setBody}
        placeholder="Write a comment. Markdown works."
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="h-11 md:h-9 md:w-fit" disabled={busy || !body.trim()}>
        Add comment
      </Button>
    </form>
  );
}
