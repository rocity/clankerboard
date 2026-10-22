import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { AuthForm } from "@/components/auth-form";
import { AuthLayout } from "@/components/auth-layout";
import { OAuthButtons } from "@/components/oauth-buttons";
import { sessionQuery } from "@/lib/queries";
import { safeRedirect } from "@/lib/redirect";

export const Route = createFileRoute("/sign-up")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safeRedirect(search.redirect),
  }),
  beforeLoad: async ({ context, search }) => {
    if (await context.queryClient.ensureQueryData(sessionQuery)) {
      throw redirect({ href: search.redirect ?? "/" });
    }
  },
  component: SignUp,
});

function SignUp() {
  const { redirect: returnTo } = Route.useSearch();
  const queryClient = useQueryClient();
  const router = useRouter();

  return (
    <AuthLayout>
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Sign up</h1>
        <AuthForm
          mode="sign-up"
          onDone={async () => {
            queryClient.clear();
            router.history.push(returnTo ?? "/");
          }}
        />
        <OAuthButtons callbackURL={returnTo ?? "/"} />
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
