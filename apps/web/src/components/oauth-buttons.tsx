import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { authProvidersQuery } from "@/lib/queries";

const labels = { github: "GitHub", google: "Google" } as const;

type Props = {
  /** Where the provider sends the User back to after sign-in. */
  callbackURL: string;
  /** Runs right before leaving for the provider. */
  beforeRedirect?: () => void;
};

/** One button per OAuth provider the operator configured. Nothing when none is. */
export function OAuthButtons({ callbackURL, beforeRedirect }: Props) {
  const { data } = useQuery(authProvidersQuery);
  const providers = data?.providers ?? [];
  if (providers.length === 0) return null;

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      {providers.map((provider) => (
        <Button
          key={provider}
          type="button"
          variant="outline"
          className="h-11"
          onClick={async () => {
            beforeRedirect?.();
            await authClient.signIn.social({
              provider,
              callbackURL,
              errorCallbackURL: "/sign-in",
            });
          }}
        >
          Continue with {labels[provider]}
        </Button>
      ))}
    </div>
  );
}
