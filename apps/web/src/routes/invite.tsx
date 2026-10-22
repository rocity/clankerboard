import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AuthForm } from "@/components/auth-form";
import { AuthLayout } from "@/components/auth-layout";
import { OAuthButtons } from "@/components/oauth-buttons";
import { Button } from "@/components/ui/button";
import { api, errorMessage, unwrap } from "@/lib/api";
import { sessionQuery } from "@/lib/queries";

// The token lives in the URL fragment, so it never reaches server logs.
const tokenFromHash = () => window.location.hash.slice(1);

export const Route = createFileRoute("/invite")({
  component: InvitePage,
});

function InvitePage() {
  const token = tokenFromHash();
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
    try {
      await unwrap(api["invite-links"].accept.$post({ json: { token } }));
      // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not in every browser yet.
      document.cookie = "cb_invite=; path=/; max-age=0";
      queryClient.clear();
      await router.navigate({ to: "/" });
    } catch (err) {
      setAcceptError(errorMessage(err));
    }
  }

  const error = lookup.error ? errorMessage(lookup.error) : acceptError;
  const invite = lookup.data?.invite;

  return (
    <AuthLayout>
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Join a company</h1>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {invite && (
          <>
            <p>
              {invite.inviterName} invited you to join{" "}
              {invite.teamName ? (
                <>
                  the {invite.teamName} team at <strong>{invite.companyName}</strong>.
                </>
              ) : (
                <>
                  <strong>{invite.companyName}</strong> as {invite.role}.
                </>
              )}
            </p>
            {user ? (
              <Button className="h-11" onClick={accept}>
                Accept invite
              </Button>
            ) : (
              <>
                <AuthForm
                  mode={mode}
                  email={invite.email}
                  headers={{ "x-invite-token": token }}
                  onDone={accept}
                />
                <OAuthButtons
                  callbackURL={`/invite#${token}`}
                  beforeRedirect={() => {
                    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not in every browser yet.
                    document.cookie = `cb_invite=${encodeURIComponent(token)}; path=/; max-age=3600; samesite=lax`;
                  }}
                />
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
          </>
        )}
      </div>
    </AuthLayout>
  );
}
