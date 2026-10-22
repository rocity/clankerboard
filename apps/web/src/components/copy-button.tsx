import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  text: string;
  /** The button's name before and after copying is "<label>" and "Copied". */
  label: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  className?: string;
};

/** Copies `text` to the clipboard and says so for two seconds. */
export function CopyButton({ text, label, variant = "outline", className }: Props) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      // Clipboard access can be blocked. The text stays selectable.
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <Button type="button" variant={variant} className={className} onClick={copy}>
      {state === "copied" ? <Check /> : <Copy />}
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </Button>
  );
}
