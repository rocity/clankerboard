import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { AuthForm } from "@/components/auth-form";
import { AuthLayout } from "@/components/auth-layout";
import { OAuthButtons } from "@/components/oauth-buttons";
import { sessionQuery } from "@/lib/queries";
import { safeRedirect } from "@/lib/redirect";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safeRedirect(search.redirect),
  }),
  beforeLoad: async ({ context, search }) => {
    if (await context.queryClient.ensureQueryData(sessionQuery)) {
      throw redirect({ href: search.redirect ?? "/" });
    }
  },
  component: SignIn,
});

function SignIn() {
  const { redirect: returnTo } = Route.useSearch();
  const queryClient = useQueryClient();
  const router = useRouter();

  return (
    <AuthLayout>
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <AuthForm
          mode="sign-in"
          onDone={async () => {
            queryClient.clear();
            router.history.push(returnTo ?? "/");
          }}
        />
        <OAuthButtons callbackURL={returnTo ?? "/"} />
        <p className="text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link
            to="/sign-up"
            search={{ redirect: returnTo }}
            className="font-medium text-foreground underline underline-offset-4"
          >
            Sign up
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
