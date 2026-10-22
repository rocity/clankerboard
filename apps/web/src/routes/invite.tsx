import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { AuthForm } from "@/components/auth-form";
import { AuthLayout } from "@/components/auth-layout";
import { OAuthButtons } from "@/components/oauth-buttons";
import { Button } from "@/components/ui/button";
import { ApiError, api, errorMessage, unwrap } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { resetActiveCompany } from "@/lib/companies";
import { clearInviteCookie, readInviteCookie, saveInviteCookie } from "@/lib/invite-cookie";
import { roleLabel } from "@/lib/members";
import { sessionQuery } from "@/lib/queries";

export const Route = createFileRoute("/invite")({
  component: InvitePage,
});

/** A link the server will not honor: not valid, revoked, used, or expired. */
const isBadLink = (error: unknown) =>
  error instanceof ApiError && [400, 404, 410].includes(error.status);

function InvitePage() {
  // The token lives in the URL fragment, so it never reaches server logs. Reading it
  // from the router keeps the page in step when a second Invite link replaces the first.
  // After an OAuth round trip the page is back on /invite with no fragment (the callback
  // URL must not carry the token), so the cookie left before leaving stands in for it.
  const hash = useRouterState({ select: (state) => state.location.hash });
  const token = hash.replace(/^#/, "") || readInviteCookie();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: user } = useQuery(sessionQuery);
  const [mode, setMode] = useState<"sign-up" | "sign-in">("sign-up");
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const lookup = useQuery({
    queryKey: ["invite", token],
    queryFn: () => unwrap(api["invite-links"].lookup.$post({ json: { token } })),
    retry: false,
  });

  async function accept() {
    setAcceptError(null);
    try {
      await unwrap(api["invite-links"].accept.$post({ json: { token } }));
      clearInviteCookie();
      queryClient.clear();
      await router.navigate({ to: "/" });
    } catch (err) {
      setAcceptError(errorMessage(err));
    }
  }

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
    resetActiveCompany();
    setAcceptError(null);
    await queryClient.invalidateQueries(sessionQuery);
  }

  if (lookup.isPending) {
    return (
      <AuthLayout signedIn={!!user}>
        <p className="text-center text-sm text-muted-foreground">Loading.</p>
      </AuthLayout>
    );
  }

  if (lookup.error) {
    return (
      <AuthLayout signedIn={!!user}>
        <div className="grid gap-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{errorMessage(lookup.error)}</h1>
          {isBadLink(lookup.error) && (
            <p className="text-sm text-muted-foreground">Ask whoever invited you for a new one.</p>
          )}
          <Button asChild variant="outline" className="h-11">
            <Link to="/">Go home</Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  const invite = lookup.data.invite;

  return (
    <AuthLayout signedIn={!!user}>
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Join {invite.companyName}</h1>

        <section
          aria-label="Invite details"
          className="rounded-xl border bg-card p-4 text-sm text-card-foreground shadow-sm"
        >
          <dl className="grid gap-3">
            <Detail label="Company" value={invite.companyName} />
            {invite.teamName && <Detail label="Team" value={invite.teamName} />}
            <Detail label="Role" value={roleLabel(invite.role)} />
            <Detail label="Invited by" value={invite.inviterName} />
          </dl>
        </section>

        {acceptError && (
          <p role="alert" className="text-sm text-destructive">
            {acceptError}
          </p>
        )}

        {user ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{user.email}</span>.
            </p>
            <Button className="h-11" onClick={accept}>
              Join {invite.companyName}
            </Button>
            <Button type="button" variant="ghost" className="h-11" onClick={signOut}>
              Sign out
            </Button>
          </div>
        ) : (
          <>
            <AuthForm
              key={mode}
              mode={mode}
              email={invite.email}
              headers={{ "x-invite-token": token }}
              onDone={accept}
            />
            <OAuthButtons callbackURL="/invite" beforeRedirect={() => saveInviteCookie(token)} />
            <Button
              type="button"
              variant="link"
              className="h-11"
              onClick={() => setMode(mode === "sign-up" ? "sign-in" : "sign-up")}
            >
              {mode === "sign-up" ? "I've signed up before" : "I'm new here"}
            </Button>
          </>
        )}
      </div>
    </AuthLayout>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
    </div>
  );
}
