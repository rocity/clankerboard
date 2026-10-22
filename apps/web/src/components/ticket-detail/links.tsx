import { statusLabels, type TicketLinkViewKind } from "@clankerboard/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Lock, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { TypeIcon } from "@/components/ticket-summary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { errorMessage } from "@/lib/api";
import type { TicketData } from "@/lib/board";
import { linksQuery, type TicketLinkData, useTicketLinkMutations } from "@/lib/ticket-detail";
import { companyTicketsQuery } from "@/lib/tickets";

/** The groups in the order the server lists them, with how each kind is picked. */
const groups: { kind: TicketLinkViewKind; label: string; pick: string }[] = [
  { kind: "blocked_by", label: "Blocked by", pick: "Blocked by" },
  { kind: "blocks", label: "Blocks", pick: "Blocks" },
  { kind: "relates_to", label: "Related", pick: "Relates to" },
];

/** A blocker that keeps the Ticket Blocked: neither Done nor archived. */
const isOpenBlocker = (link: TicketLinkData) =>
  link.kind === "blocked_by" && link.status !== "done" && !link.archived;

/** "PLAT-3, PLAT-5, and PLAT-7". */
const inWords = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** How many matches the search shows. Typing more narrows it. */
const maxMatches = 8;

const rowClass =
  "flex min-h-11 min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-9";

type Props = {
  companySlug: string;
  projectKey: string;
  ticket: TicketData;
};

type RowProps = {
  companySlug: string;
  projectKey: string;
  link: TicketLinkData;
  onUnlink: (key: string) => void;
};

/** One linked Ticket. It opens in its own Project, which may not be this one. */
function LinkedTicket({ companySlug, projectKey, link, onUnlink }: RowProps) {
  const sameProject = link.projectKey === projectKey;
  return (
    <li className="flex min-w-0 items-center gap-1">
      <Link
        to="/$companySlug/projects/$projectKey/tickets/$ticketKey"
        params={{ companySlug, projectKey: link.projectKey, ticketKey: link.key }}
        // The board's filters belong to this Project's board, so they only carry over within it.
        search={(prev) => (sameProject ? prev : {})}
        className={`${rowClass} flex-1`}
      >
        <TypeIcon type={link.type} className="text-muted-foreground" />
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{link.key}</span>
        <span className="min-w-0 flex-1 truncate">{link.title}</span>
        {link.archived && (
          <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            Archived
          </span>
        )}
        <span className="shrink-0 rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium">
          {statusLabels[link.status]}
        </span>
      </Link>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 text-muted-foreground md:size-9"
        aria-label={`Unlink ${link.key}`}
        onClick={() => onUnlink(link.key)}
      >
        <X />
      </Button>
    </li>
  );
}

type AddProps = {
  ticketKey: string;
  linked: string[];
  onPick: (kind: TicketLinkViewKind, target: string) => Promise<boolean>;
  onCancel: () => void;
};

/**
 * Picks a kind and another live Ticket of the Company, matched by key or title.
 * The Ticket itself and Tickets it is already linked to are not offered: the
 * server would refuse them.
 */
function AddLink({ ticketKey, linked, onPick, onCancel }: AddProps) {
  const id = useId();
  const [kind, setKind] = useState<TicketLinkViewKind>("blocked_by");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: tickets, isPending } = useQuery(companyTicketsQuery);

  const wanted = search.trim().toLowerCase();
  const matches = wanted
    ? (tickets ?? [])
        .filter((t) => t.key !== ticketKey && !linked.includes(t.key))
        .filter(
          (t) => t.key.toLowerCase().includes(wanted) || t.title.toLowerCase().includes(wanted),
        )
        .slice(0, maxMatches)
    : [];

  return (
    <div className="grid gap-2 rounded-md border p-3">
      <div className="grid gap-2 md:grid-cols-[10rem_1fr]">
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-kind`} className="text-xs text-muted-foreground">
            Kind
          </Label>
          <NativeSelect
            id={`${id}-kind`}
            value={kind}
            onChange={(event) => setKind(event.target.value as TicketLinkViewKind)}
          >
            {groups.map((group) => (
              <option key={group.kind} value={group.kind}>
                {group.pick}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-search`} className="text-xs text-muted-foreground">
            Find a ticket
          </Label>
          <Input
            id={`${id}-search`}
            type="search"
            autoComplete="off"
            placeholder="Key or title"
            className="h-11 md:h-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {wanted &&
        (isPending ? (
          <p className="text-sm text-muted-foreground">Loading tickets.</p>
        ) : matches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ticket matches.</p>
        ) : (
          <ul aria-label="Matching tickets" className="grid gap-1.5">
            {matches.map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  disabled={saving}
                  className={`${rowClass} w-full text-left disabled:opacity-50`}
                  onClick={async () => {
                    setSaving(true);
                    const added = await onPick(kind, t.key);
                    setSaving(false);
                    if (added) setSearch("");
                  }}
                >
                  <TypeIcon type={t.type} className="text-muted-foreground" />
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{t.key}</span>
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}
      <div>
        <Button type="button" variant="ghost" className="h-11 md:h-9" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * The Ticket's Links, grouped as Blocked by, Blocks, and Related, with a way
 * to add and remove them. An archived Ticket can't gain Links, so it offers
 * only removal.
 */
export function Links({ companySlug, projectKey, ticket }: Props) {
  const { data: links = [] } = useQuery(linksQuery(ticket.key));
  const mutations = useTicketLinkMutations(ticket.key);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = ticket.archivedAt !== null;
  // Open blockers are what keep the Ticket Blocked, so they come first in their group.
  const sorted = [...links.filter(isOpenBlocker), ...links.filter((link) => !isOpenBlocker(link))];
  const openBlockers = links.filter(isOpenBlocker).map((link) => link.key);

  /** Runs one change. A refusal shows as the server's message. Resolves whether it worked. */
  async function run(change: () => Promise<unknown>) {
    setError(null);
    try {
      await change();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  return (
    <section aria-labelledby="links-heading" className="grid gap-3">
      <h3 id="links-heading" className="text-sm font-semibold">
        Links
      </h3>
      {/*
        Read from the Links, not the Ticket's own `blocked`: it is the same rule, and the
        Links are what a blocker finishing refreshes, so the notice and the list never disagree.
      */}
      {openBlockers.length > 0 && (
        <p
          role="note"
          className="flex items-center gap-2 rounded-md bg-amber-500/15 px-3 py-2 text-sm font-medium text-amber-900 dark:bg-amber-400/15 dark:text-amber-100"
        >
          <Lock aria-hidden className="size-4 shrink-0" />
          Blocked by {inWords.format(openBlockers)}.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {groups.map(({ kind, label }) => {
        const members = sorted.filter((link) => link.kind === kind);
        if (members.length === 0) return null;
        const id = `links-${kind}`;
        return (
          <div key={kind} className="grid gap-1.5">
            <h4 id={id} className="text-xs font-medium text-muted-foreground">
              {label}
            </h4>
            <ul aria-labelledby={id} className="grid gap-1.5">
              {members.map((link) => (
                <LinkedTicket
                  key={link.key}
                  companySlug={companySlug}
                  projectKey={projectKey}
                  link={link}
                  onUnlink={(key) => void run(() => mutations.unlink.mutateAsync(key))}
                />
              ))}
            </ul>
          </div>
        );
      })}
      {!archived &&
        (adding ? (
          <AddLink
            ticketKey={ticket.key}
            linked={links.map((link) => link.key)}
            onPick={async (kind, target) => {
              const added = await run(() => mutations.link.mutateAsync({ kind, target }));
              if (added) setAdding(false);
              return added;
            }}
            onCancel={() => {
              setAdding(false);
              setError(null);
            }}
          />
        ) : (
          <div>
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => setAdding(true)}
            >
              <Plus />
              Add a linked ticket
            </Button>
          </div>
        ))}
    </section>
  );
}
