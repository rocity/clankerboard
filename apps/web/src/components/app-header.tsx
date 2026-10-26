import { productName } from "@agentkanban/shared";
import { Link } from "@tanstack/react-router";
import { SquareKanban } from "lucide-react";
import { Brand } from "@/components/brand";
import { CompanyNav } from "@/components/company-nav";
import { CompanySwitcher } from "@/components/company-switcher";
import { ProjectSidebarToggle } from "@/components/project-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";

type Props = {
  companySlug: string;
  /** Whether the Project sidebar shows on a wide screen. */
  sidebarShown: boolean;
  onToggleSidebar: () => void;
};

export function AppHeader({ companySlug, sidebarShown, onToggleSidebar }: Props) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-4 md:gap-4 md:px-6">
        <ProjectSidebarToggle
          companySlug={companySlug}
          shown={sidebarShown}
          onToggle={onToggleSidebar}
        />
        <Link
          to="/$companySlug"
          params={{ companySlug }}
          aria-label={productName}
          className="flex size-11 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:size-auto"
        >
          <span className="hidden md:block">
            <Brand />
          </span>
          <SquareKanban className="size-6 text-primary md:hidden" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <CompanySwitcher activeSlug={companySlug} />
        </div>
        <div className="flex shrink-0 items-center">
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
      <CompanyNav companySlug={companySlug} />
    </header>
  );
}
