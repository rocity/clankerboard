import type { LabelColor } from "@agentkanban/shared";
import { X } from "lucide-react";
import { labelColorClasses } from "@/lib/labels";
import { cn } from "@/lib/utils";

type Props = {
  label: { name: string; color: LabelColor };
  /** Adds a control that takes the Label off, named "Remove label <name>". */
  onRemove?: () => void;
  disabled?: boolean;
  className?: string;
};

/** A Label: its color as a dot and a tint, and its name, cut short when the space runs out. */
export function LabelChip({ label, onRemove, disabled, className }: Props) {
  const colors = labelColorClasses[label.color];
  return (
    <span
      data-testid="label"
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        colors.chip,
        className,
      )}
    >
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", colors.dot)} />
      <span className="truncate">{label.name}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove label ${label.name}`}
          disabled={disabled}
          onClick={onRemove}
          // A bigger hit area than the icon, without making the chip taller.
          className="-my-1 -mr-1.5 flex size-6 shrink-0 items-center justify-center rounded-full outline-none hover:bg-foreground/10 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
        >
          <X aria-hidden className="size-3" />
        </button>
      )}
    </span>
  );
}
