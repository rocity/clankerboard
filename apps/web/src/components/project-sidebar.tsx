import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PanelLeft, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { projectsQuery } from "@/lib/projects";

/** The localStorage key for whether the sidebar is hidden on a wide screen. */
const hiddenStorageKey = "agentkanban-project-sidebar-hidden";

/** Whether the Project sidebar shows on a wide screen. It is remembered per browser. */
export function useProjectSidebar() {
  const [shown, setShown] = useState(() => {
    try {
      return localStorage.getItem(hiddenStorageKey) !== "true";
    } catch {
      return true;
    }
  });

  function toggle() {
    const next = !shown;
    setShown(next);
    try {
      if (next) localStorage.removeItem(hiddenStorageKey);
      else localStorage.setItem(hiddenStorageKey, "true");
    } catch {
      // Storage can be blocked. The choice then lasts until the page reloads.
    }
  }

  return { shown, toggle };
}

type Props = { companySlug: string };

/**
 * The Company's Projects down the left edge, from the `2xl` breakpoint. Below it
 * the sidebar would squeeze the board until its five Statuses no longer fit, so
 * the header button opens the list in a panel instead. It sticks below the header
 * (56px top row, 40px nav, 1px border) and scrolls on its own.
 */
export function ProjectSidebar({ companySlug, shown }: Props & { shown: boolean }) {
  if (!shown) return null;
  return (
    <aside className="sticky top-[97px] hidden h-[calc(100dvh-97px)] w-60 shrink-0 overflow-y-auto border-r 2xl:block">
      <ProjectNav companySlug={companySlug} />
    </aside>
  );
}

/**
 * The header button for the sidebar: below `2xl` it opens the Projects in a panel
 * from the left, from `2xl` it shows or hides the sidebar.
 */
export function ProjectSidebarToggle({
  companySlug,
  shown,
  onToggle,
}: Props & { shown: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 md:size-9 2xl:hidden"
        aria-label="Switch project"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <PanelLeft className="size-5 md:size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="hidden size-9 2xl:inline-flex"
        aria-label={shown ? "Hide projects" : "Show projects"}
        aria-pressed={shown}
        onClick={onToggle}
      >
        <PanelLeft className="size-4" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" aria-describedby={undefined} className="max-w-xs md:max-w-xs">
          <div className="flex items-center justify-between border-b py-1 pr-1 pl-4">
            <SheetTitle className="text-base font-semibold">Projects</SheetTitle>
            <SheetClose asChild>
              <Button variant="ghost" size="icon" className="size-11" aria-label="Close">
                <X className="size-5" />
              </Button>
            </SheetClose>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ProjectNav companySlug={companySlug} onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

// A link per Project, the open one marked. It reads the same list as the Projects
// page, so a Project created or renamed anywhere shows here without a reload.
function ProjectNav({ companySlug, onNavigate }: Props & { onNavigate?: () => void }) {
  const { data: projects, error } = useQuery(projectsQuery(null));

  return (
    <nav aria-label="Projects" className="grid gap-1 p-2 md:p-3">
      <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Projects</p>
      {error ? (
        <p role="alert" className="px-2 text-sm text-destructive">
          The projects did not load.
        </p>
      ) : projects?.length === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">No projects.</p>
      ) : (
        <ul className="grid gap-0.5">
          {projects?.map((project) => (
            <li key={project.id}>
              <Link
                to="/$companySlug/projects/$projectKey"
                params={{ companySlug, projectKey: project.key }}
                onClick={onNavigate}
                className="flex min-h-11 items-center justify-between gap-2 rounded-md px-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[status=active]:bg-accent data-[status=active]:font-medium data-[status=active]:text-foreground md:min-h-8"
              >
                <span className="truncate">{project.name}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {project.key}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
