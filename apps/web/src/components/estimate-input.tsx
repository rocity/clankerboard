import type * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A number field for an Estimate, with "pts" after the number. Empty means
 * blank. It takes whatever is typed: the shared schema or the server checks
 * the 0 to 100 range, so their message is the one shown.
 */
export function EstimateInput({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <div className="relative">
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        step={1}
        placeholder="None"
        autoComplete="off"
        className={cn(
          "h-11 pr-10 md:h-9",
          // The browser's spin buttons would sit under "pts", and typing is quicker anyway.
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          className,
        )}
        {...props}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground"
      >
        pts
      </span>
    </div>
  );
}
