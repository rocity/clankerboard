import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { AuthForm } from "@/components/auth-form";
import { AuthLayout } from "@/components/auth-layout";
import { OAuthButtons } from "@/components/oauth-buttons";
import { configQuery, sessionQuery } from "@/lib/queries";
import { safeRedirect } from "@/lib/redirect";

export const Route = createFileRoute("/sign-up")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safeRedirect(search.redirect),
  }),
  beforeLoad: async ({ context, search }) => {
    if (await context.queryClient.ensureQueryData(sessionQuery)) {
      throw redirect({ href: search.redirect ?? "/" });
    }
    // Whether sign-up is open decides what the screen shows. If the question
    // fails, show the form and let the server answer when it is submitted.
    const config = await context.queryClient
      .fetchQuery({ ...configQuery, staleTime: 0 })
      .catch(() => null);
    return { signUpOpen: config?.signUpOpen ?? true };
  },
  component: SignUp,
});

function SignUp() {
  const { redirect: returnTo } = Route.useSearch();
  const { signUpOpen } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const router = useRouter();

  return (
    <AuthLayout>
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Sign up</h1>
        {signUpOpen ? (
          <>
            <AuthForm
              mode="sign-up"
              onDone={async () => {
                queryClient.clear();
                router.history.push(returnTo ?? "/");
              }}
            />
            <OAuthButtons callbackURL={returnTo ?? "/"} />
          </>
        ) : (
          <p className="rounded-md border bg-muted p-3 text-sm">
            Sign-up needs an invite. Ask for an invite link.
          </p>
        )}
        <p className="text-center text-sm text-muted-foreground">
          Signed up before?{" "}
          <Link
            to="/sign-in"
            search={{ redirect: returnTo }}
            className="font-medium text-foreground underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
