import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type Props = {
  mode: "sign-in" | "sign-up";
  /** Fixes the email, as on an Invite page. */
  email?: string;
  /** Extra request headers, such as the Invite token for an Invite sign-up. */
  headers?: Record<string, string>;
  onDone: () => void;
};

export function AuthForm({ mode, email: fixedEmail, headers, onDone }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setBusy(true);
    setError(null);
    const result =
      mode === "sign-up"
        ? await authClient.signUp.email(
            { name: String(form.get("name")), email, password },
            { headers },
          )
        : await authClient.signIn.email({ email, password }, { headers });
    setBusy(false);
    if (result.error) {
      setError(result.error.message || "Something went wrong.");
      return;
    }
    onDone();
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      {mode === "sign-up" && (
        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            required
            className="h-11 text-base md:text-sm"
          />
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={fixedEmail}
          readOnly={fixedEmail !== undefined}
          required
          className="h-11 text-base md:text-sm"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          minLength={8}
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
        {mode === "sign-up" ? "Sign up" : "Sign in"}
      </Button>
    </form>
  );
}
