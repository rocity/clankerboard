import { useEffect, useState } from "react";
import { api } from "./api";

const labels: Record<string, string> = { github: "GitHub", google: "Google" };

type Props = {
  callbackURL?: string;
  /** Runs right before leaving for the provider. */
  beforeRedirect?: () => void;
};

// Shows only the providers the operator configured.
export function OAuthButtons({ callbackURL = "/", beforeRedirect }: Props) {
  const [providers, setProviders] = useState<string[]>([]);

  useEffect(() => {
    api<{ providers: string[] }>("/api/auth-providers")
      .then((res) => setProviders(res.providers))
      .catch(() => setProviders([]));
  }, []);

  if (providers.length === 0) return null;

  return (
    <div className="stack">
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          onClick={async () => {
            const { url } = await api<{ url: string }>("/api/auth/sign-in/social", {
              method: "POST",
              body: JSON.stringify({ provider, callbackURL, errorCallbackURL: "/sign-in" }),
            });
            beforeRedirect?.();
            window.location.assign(url);
          }}
        >
          Continue with {labels[provider] ?? provider}
        </button>
      ))}
    </div>
  );
}
