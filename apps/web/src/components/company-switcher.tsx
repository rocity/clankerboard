import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useState } from "react";
import { CreateCompanyForm } from "@/components/create-company-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { companiesQuery } from "@/lib/queries";

type Props = {
  /** The slug of the Company the page is showing. */
  activeSlug: string;
};

export function CompanySwitcher({ activeSlug }: Props) {
  const navigate = useNavigate();
  const { data } = useQuery(companiesQuery);
  const [creating, setCreating] = useState(false);
  const companies = data?.companies ?? [];
  const active = companies.find((c) => c.slug === activeSlug);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="h-11 min-w-0 max-w-full justify-between gap-2 md:h-9 md:max-w-64"
            aria-label="Company"
          >
            <span className="truncate">{active?.name ?? activeSlug}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-2rem)]">
          <DropdownMenuLabel>Companies</DropdownMenuLabel>
          {companies.map((company) => (
            <DropdownMenuItem
              key={company.id}
              className="min-h-11 md:min-h-0"
              onSelect={() =>
                navigate({ to: "/$companySlug", params: { companySlug: company.slug } })
              }
            >
              <span className="truncate">{company.name}</span>
              {company.slug === activeSlug && <Check className="ml-auto" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="min-h-11 md:min-h-0" onSelect={() => setCreating(true)}>
            <Plus />
            Create company
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a company</DialogTitle>
            <DialogDescription>You become an owner.</DialogDescription>
          </DialogHeader>
          <CreateCompanyForm
            onCreated={(company) => {
              setCreating(false);
              navigate({ to: "/$companySlug", params: { companySlug: company.slug } });
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
