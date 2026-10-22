import { SquareKanban } from "lucide-react";

export function Brand() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <SquareKanban className="size-6 text-primary" aria-hidden />
      <span>Clankerboard</span>
    </span>
  );
}
