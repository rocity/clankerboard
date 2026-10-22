import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";
import { useThemePreference } from "@/lib/theme";

/** Short messages that fade on their own, in the app's own theme. */
export function Toaster() {
  const theme = useThemePreference();

  return (
    <Sonner
      theme={theme}
      position="bottom-center"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as CSSProperties
      }
    />
  );
}
