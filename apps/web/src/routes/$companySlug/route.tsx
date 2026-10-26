import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppHeader } from "@/components/app-header";
import { AuthLayout } from "@/components/auth-layout";
import { ProjectSidebar, useProjectSidebar } from "@/components/project-sidebar";
import { StreamNotice } from "@/components/stream-notice";
import { Button } from "@/components/ui/button";
import { activateCompany } from "@/lib/companies";
import { ensureStream, stopStream } from "@/lib/live-stream";
import { requireSession } from "@/lib/redirect";

// Every route under a Company slug. The server reads the active Company from the
// session, so entering one makes it the active Company before anything loads.
export const Route = createFileRoute("/$companySlug")({
  beforeLoad: async ({ context, location, params, preload }) => {
    await requireSession(context.queryClient, location);
    const company = await activateCompany(context.queryClient, params.companySlug);
    if (!company) throw notFound();
    // The live stream opens before any loader fetches, so a change made in
    // between reaches the board. A hover preload must not open one.
    if (!preload) await ensureStream(context.queryClient, company.id);
    return { company };
  },
  component: CompanyLayout,
  notFoundComponent: CompanyNotFound,
});

function CompanyLayout() {
  const { companySlug } = Route.useParams();
  const { company } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const sidebar = useProjectSidebar();

  // One stream per tab, for as long as a Company page is open. `ensureStream`
  // already ran in `beforeLoad`; this repeats it for a remount (StrictMode).
  useEffect(() => {
    void ensureStream(queryClient, company.id);
    return () => stopStream(company.id);
  }, [queryClient, company.id]);

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader
        companySlug={companySlug}
        sidebarShown={sidebar.shown}
        onToggleSidebar={sidebar.toggle}
      />
      <div className="flex flex-1">
        <ProjectSidebar companySlug={companySlug} shown={sidebar.shown} />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </div>
      <StreamNotice />
    </div>
  );
}

function CompanyNotFound() {
  return (
    <AuthLayout signedIn>
      <div className="grid gap-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Company not found</h1>
        <p className="text-sm text-muted-foreground">You are not in a company with this address.</p>
        <Button asChild className="h-11">
          <a href="/">Go home</a>
        </Button>
      </div>
    </AuthLayout>
  );
}
