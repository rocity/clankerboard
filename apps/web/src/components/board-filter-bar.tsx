import { ticketPriorities, ticketTypes } from "@clankerboard/shared";
import { useQuery } from "@tanstack/react-query";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { type ReactNode, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { actorsQuery } from "@/lib/actors";
import { activeFilterCount, type BoardSearch } from "@/lib/board-search";
import { teamsQuery } from "@/lib/projects";
import { ticketsQuery } from "@/lib/tickets";

const capitalized = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** How long typing pauses before the search reaches the URL and the server. */
const searchDelay = 300;

type Props = {
  projectKey: string;
  search: BoardSearch;
  onChange: (patch: Partial<BoardSearch>) => void | Promise<void>;
  onClear: () => void | Promise<void>;
};

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5 md:w-40">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

/**
 * Search and filters for one board. Everything it edits lives in the URL
 * (`search`), so a filtered view can be shared. From `md` the filters sit in a
 * row under the search box. On a phone they fold behind a "Filters" button, so
 * the board stays in view.
 */
export function BoardFilterBar({
  projectKey,
  search: committed,
  onChange: commit,
  onClear: clear,
}: Props) {
  const [open, setOpen] = useState(false);
  // The URL updates a moment after a click. Until it does, show the choice made, so
  // a control never springs back and then forward.
  const [search, showOptimistically] = useOptimistic(
    committed,
    (current, patch: Partial<BoardSearch> | null) => (patch ? { ...current, ...patch } : {}),
  );
  const [, startTransition] = useTransition();
  const onChange = (patch: Partial<BoardSearch>) =>
    startTransition(async () => {
      showOptimistically(patch);
      await commit(patch);
    });
  const onClear = () =>
    startTransition(async () => {
      showOptimistically(null);
      await clear();
    });
  const count = activeFilterCount(search);

  // The unfiltered board is what the Epic choices come from, so a filter never hides one.
  const { data: tickets = [] } = useQuery(ticketsQuery(projectKey));
  const { data: actors = [] } = useQuery(actorsQuery);
  const { data: teams = [] } = useQuery(teamsQuery);
  const epics = tickets.filter((t) => t.type === "epic");
  const users = actors.filter((a) => a.type === "user");
  const agents = actors.filter((a) => a.type === "agent");

  const assigneeKnown =
    !search.assignee ||
    ["me", "unassigned", "agents", "users"].includes(search.assignee) ||
    actors.some((a) => `${a.type}:${a.id}` === search.assignee);

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <SearchBox query={search.q} onCommit={(q) => onChange({ q })} />
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          aria-controls="board-filters"
          onClick={() => setOpen(!open)}
          className="h-11 shrink-0 md:hidden"
        >
          <SlidersHorizontal aria-hidden />
          Filters
          {count > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
              {count}
              <span className="sr-only"> active</span>
            </span>
          )}
        </Button>
      </div>

      <div
        id="board-filters"
        className={`grid-cols-2 gap-3 md:flex md:flex-wrap md:items-end ${open ? "grid" : "hidden md:flex"}`}
      >
        <Field id="filter-assignee" label="Assignee">
          <NativeSelect
            id="filter-assignee"
            value={search.assignee ?? ""}
            onChange={(e) => onChange({ assignee: e.target.value || undefined })}
          >
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="unassigned">Unassigned</option>
            <option value="agents">Any agent</option>
            <option value="users">Any user</option>
            {users.length > 0 && (
              <optgroup label="Users">
                {users.map((a) => (
                  <option key={a.id} value={`user:${a.id}`}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            )}
            {agents.length > 0 && (
              <optgroup label="Agents">
                {agents.map((a) => (
                  <option key={a.id} value={`agent:${a.id}`}>
                    {a.revoked ? `${a.name} (revoked)` : a.name}
                  </option>
                ))}
              </optgroup>
            )}
            {!assigneeKnown && <option value={search.assignee}>Unknown assignee</option>}
          </NativeSelect>
        </Field>
        <Field id="filter-priority" label="Priority">
          <NativeSelect
            id="filter-priority"
            value={search.priority ?? ""}
            onChange={(e) =>
              onChange({ priority: (e.target.value || undefined) as BoardSearch["priority"] })
            }
          >
            <option value="">Any priority</option>
            {ticketPriorities.map((p) => (
              <option key={p} value={p}>
                {capitalized(p)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="filter-type" label="Type">
          <NativeSelect
            id="filter-type"
            value={search.type ?? ""}
            onChange={(e) =>
              onChange({ type: (e.target.value || undefined) as BoardSearch["type"] })
            }
          >
            <option value="">Any type</option>
            {ticketTypes.map((t) => (
              <option key={t} value={t}>
                {capitalized(t)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="filter-epic" label="Epic">
          <NativeSelect
            id="filter-epic"
            value={search.epic ?? ""}
            onChange={(e) => onChange({ epic: e.target.value || undefined })}
          >
            <option value="">Any epic</option>
            {epics.map((epic) => (
              <option key={epic.key} value={epic.key}>
                {epic.key} {epic.title}
              </option>
            ))}
            {search.epic && !epics.some((e) => e.key === search.epic) && (
              <option value={search.epic}>{search.epic}</option>
            )}
          </NativeSelect>
        </Field>
        <Field id="filter-team" label="Team">
          <NativeSelect
            id="filter-team"
            value={search.team ?? ""}
            onChange={(e) => onChange({ team: e.target.value || undefined })}
          >
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            {search.team && !teams.some((t) => t.id === search.team) && (
              <option value={search.team}>Unknown team</option>
            )}
          </NativeSelect>
        </Field>
        <Label
          htmlFor="filter-archived"
          className="col-span-2 min-h-11 cursor-pointer gap-2.5 text-sm md:col-span-1 md:min-h-9"
        >
          <input
            id="filter-archived"
            type="checkbox"
            checked={search.archived === true}
            onChange={(e) => onChange({ archived: e.target.checked ? true : undefined })}
            className="size-5 accent-primary md:size-4"
          />
          Show archived
        </Label>
        {count > 0 && (
          <Button
            type="button"
            variant="ghost"
            onClick={onClear}
            className="col-span-2 h-11 md:col-span-1 md:h-9"
          >
            <X aria-hidden />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The search field. Typing is held locally and sent on after a pause, so the
 * server is not asked on every key. A change to the URL that did not come from
 * here (back, a link, Clear filters) replaces the text.
 */
function SearchBox({
  query,
  onCommit,
}: {
  query: string | undefined;
  onCommit: (q: string | undefined) => void;
}) {
  const [text, setText] = useState(query ?? "");
  const sent = useRef(query);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (query !== sent.current) {
      sent.current = query;
      setText(query ?? "");
    }
  }, [query]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function type(value: string) {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = value.trim() || undefined;
      sent.current = next;
      onCommit(next);
    }, searchDelay);
  }

  return (
    <div className="relative min-w-0 flex-1 md:max-w-sm">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label="Search"
        placeholder="Search tickets"
        value={text}
        maxLength={200}
        onChange={(e) => type(e.target.value)}
        className="h-11 pl-9 md:h-9"
      />
    </div>
  );
}
