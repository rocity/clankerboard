import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  actor: { type: "user" | "agent"; name: string; revoked?: boolean };
  /** Spells out "Agent" next to the icon, for places with room. */
  labelled?: boolean;
  className?: string;
};

/** An Actor's name. An Agent carries the bot icon, so it is never mistaken for a User. */
export function ActorName({ actor, labelled = false, className }: Props) {
  const name = actor.revoked ? `${actor.name} (revoked)` : actor.name;
  if (actor.type === "user") {
    return (
      <span className={cn("min-w-0 font-medium [overflow-wrap:anywhere]", className)}>{name}</span>
    );
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <Bot role="img" aria-label="Agent" className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{name}</span>
      {labelled && (
        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
          Agent
        </span>
      )}
    </span>
  );
}
