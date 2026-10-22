import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { AuthLayout } from "@/components/auth-layout";
import { CreateCompanyForm } from "@/components/create-company-form";
import { pickLandingCompany } from "@/lib/companies";
import { companiesQuery } from "@/lib/queries";
import { requireSession } from "@/lib/redirect";

// Signed in: go to the Company to land on. With no Company yet, this page asks
// for one.
export const Route = createFileRoute("/")({
  beforeLoad: async ({ context, location }) => {
    await requireSession(context.queryClient, location);
    const data = await context.queryClient.fetchQuery({ ...companiesQuery, staleTime: 0 });
    const company = pickLandingCompany(data);
    if (company) throw redirect({ to: "/$companySlug", params: { companySlug: company.slug } });
  },
  component: FirstCompany,
});

function FirstCompany() {
  const navigate = useNavigate();

  return (
    <AuthLayout signedIn>
      <div className="grid gap-6">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Create your company</h1>
          <p className="text-sm text-muted-foreground">Projects, Teams, and Agents live in one.</p>
        </div>
        <CreateCompanyForm
          onCreated={(company) =>
            navigate({ to: "/$companySlug", params: { companySlug: company.slug } })
          }
        />
      </div>
    </AuthLayout>
  );
}
