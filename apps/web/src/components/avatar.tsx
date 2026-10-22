import { initials } from "@/lib/initials";

/** A User's initials in a circle. The API sends no profile images. */
export function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-medium text-secondary-foreground"
    >
      {initials(name)}
    </span>
  );
}
