import { canManageLabels } from "@agentkanban/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LabelList } from "@/components/label-list";
import { errorMessage } from "@/lib/api";
import { labelsQuery } from "@/lib/labels";

export const Route = createFileRoute("/$companySlug/labels")({
  component: LabelsPage,
});

function LabelsPage() {
  const { company } = Route.useRouteContext();
  const labels = useQuery(labelsQuery);
  const manages = canManageLabels(company.role);

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-8">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Labels</h1>
        <p className="text-sm text-muted-foreground">
          Labels group tickets across every project in {company.name}. Anyone adds one by putting it
          on a ticket.
          {manages ? "" : " Owners and admins rename, recolor, and delete them."}
        </p>
      </div>

      <section aria-label="Labels in this company" className="grid gap-3">
        {labels.isPending && <p className="text-sm text-muted-foreground">Loading.</p>}
        {labels.error && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(labels.error)}
          </p>
        )}
        {labels.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No labels yet. Add one from a ticket.</p>
        )}
        {labels.data && labels.data.length > 0 && (
          <LabelList labels={labels.data} manages={manages} />
        )}
      </section>
    </div>
  );
}
