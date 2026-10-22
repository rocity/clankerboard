import { createCompanyInput } from "@clankerboard/shared";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage, unwrap } from "@/lib/api";
import { rememberCompany } from "@/lib/companies";
import { companiesQuery } from "@/lib/queries";

type Props = {
  onCreated: (company: { slug: string }) => void;
};

/** Creates a Company, which makes it the session's active one. */
export function CreateCompanyForm({ onCreated }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createCompanyInput.safeParse({
      name: new FormData(event.currentTarget).get("name"),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { company } = await unwrap(api.companies.$post({ json: parsed.data }));
      rememberCompany(company.slug);
      await queryClient.invalidateQueries(companiesQuery);
      onCreated(company);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-2">
        <Label htmlFor="company-name">Company name</Label>
        <Input
          id="company-name"
          name="name"
          autoComplete="organization"
          required
          className="h-11 text-base md:text-sm"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="h-11" disabled={busy}>
        Create company
      </Button>
    </form>
  );
}
