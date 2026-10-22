import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/$companySlug/")({
  component: CompanyHome,
});

function CompanyHome() {
  const { company } = Route.useRouteContext();

  return (
    <div className="grid gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
      <p className="text-sm text-muted-foreground">
        Your role: <span className="font-medium text-foreground">{company.role}</span>
      </p>
    </div>
  );
}
