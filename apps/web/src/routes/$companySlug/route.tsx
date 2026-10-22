import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { AppHeader } from "@/components/app-header";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { activateCompany } from "@/lib/companies";
import { requireSession } from "@/lib/redirect";

// Every route under a Company slug. The server reads the active Company from the
// session, so entering one makes it the active Company before anything loads.
export const Route = createFileRoute("/$companySlug")({
  beforeLoad: async ({ context, location, params }) => {
    await requireSession(context.queryClient, location);
    const company = await activateCompany(context.queryClient, params.companySlug);
    if (!company) throw notFound();
    return { company };
  },
  component: CompanyLayout,
  notFoundComponent: CompanyNotFound,
});

function CompanyLayout() {
  const { companySlug } = Route.useParams();

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader companySlug={companySlug} />
      <main className="flex-1 px-4 py-6 md:px-6">
        <Outlet />
      </main>
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
