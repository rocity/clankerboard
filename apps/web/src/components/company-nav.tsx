import { Link } from "@tanstack/react-router";

// Later work adds its pages here. The row scrolls sideways on a narrow screen
// instead of wrapping, so the header stays one line tall.
export function CompanyNav({ companySlug }: { companySlug: string }) {
  const linkClass =
    "flex h-11 shrink-0 items-center border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[status=active]:border-primary data-[status=active]:text-foreground md:h-10";

  return (
    <nav aria-label="Company pages" className="overflow-x-auto px-1 md:px-3">
      <div className="flex">
        <Link to="/$companySlug/teams" params={{ companySlug }} className={linkClass}>
          Teams
        </Link>
        <Link to="/$companySlug/members" params={{ companySlug }} className={linkClass}>
          Members
        </Link>
      </div>
    </nav>
  );
}
