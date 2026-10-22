import { statusLabels } from "@clankerboard/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { TypeIcon } from "@/components/ticket-summary";
import { childrenQuery } from "@/lib/ticket-detail";

type Props = {
  companySlug: string;
  projectKey: string;
  ticketKey: string;
};

/** The Ticket's direct children with their Status. Each opens its own panel. */
export function Children({ companySlug, projectKey, ticketKey }: Props) {
  const { data: children } = useQuery(childrenQuery(ticketKey));
  if (!children || children.length === 0) return null;

  return (
    <section aria-labelledby="children-heading" className="grid gap-2">
      <h3 id="children-heading" className="text-sm font-semibold">
        Children ({children.length})
      </h3>
      <ul className="grid gap-1.5">
        {children.map((child) => (
          <li key={child.key}>
            <Link
              to="/$companySlug/projects/$projectKey/tickets/$ticketKey"
              params={{ companySlug, projectKey, ticketKey: child.key }}
              search={(prev) => prev}
              className="flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-9"
            >
              <TypeIcon type={child.type} className="text-muted-foreground" />
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{child.key}</span>
              <span className="min-w-0 flex-1 truncate">{child.title}</span>
              <span className="shrink-0 rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium">
                {statusLabels[child.status]}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
