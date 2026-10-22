import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** What the server returns when it creates or resends an Invite. The link is shown only this once. */
export type IssuedInvite = {
  invite: { email: string };
  link: string;
  emailed: boolean;
};

type Props = {
  issued: IssuedInvite;
  onDone: () => void;
};

/** Shows a fresh Invite link with a copy button, right after it is created or resent. */
export function InviteLinkPanel({ issued, onDone }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.link);
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access can be blocked. Select the text so the person can copy it by hand.
      input.current?.select();
      setCopyFailed(true);
    }
  }

  return (
    <section
      aria-label="New invite"
      className="grid gap-3 rounded-xl border border-primary/40 bg-accent/60 p-4"
    >
      <div className="grid gap-0.5">
        <h3 className="font-medium">Invite ready for {issued.invite.email}</h3>
        <p className="text-sm text-muted-foreground">
          {issued.emailed ? `Emailed to ${issued.invite.email}.` : "Send it to them yourself."}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          ref={input}
          readOnly
          aria-label="Invite link"
          value={issued.link}
          onFocus={(event) => event.currentTarget.select()}
          className="h-11 font-mono text-base md:h-9 md:text-sm"
        />
        <Button type="button" className="h-11 sm:h-9" onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      {copyFailed && (
        <p role="status" className="text-sm text-muted-foreground">
          Copy failed. Select the text and copy it.
        </p>
      )}
      <div>
        <Button type="button" variant="ghost" className="h-11 sm:h-9" onClick={onDone}>
          Done
        </Button>
      </div>
    </section>
  );
}
