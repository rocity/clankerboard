import { useCallback, useEffect, useState } from "react";
import { AuthForm } from "./AuthForm";
import { api, type Me } from "./api";
import { CompanyHome } from "./CompanyHome";
import { InvitePage } from "./InvitePage";
import { OAuthButtons } from "./OAuthButtons";
import { navigate, usePath } from "./router";

export function App() {
  const path = usePath();
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const refresh = useCallback(() => {
    api<Me>("/api/me")
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  useEffect(refresh, [refresh]);

  if (me === undefined) return null;

  const signedIn = () => {
    refresh();
    navigate("/");
  };

  if (path === "/invite") {
    return (
      <Page title="Join a company">
        <InvitePage me={me} onJoined={signedIn} />
      </Page>
    );
  }

  if (path === "/sign-up") {
    return (
      <Page title="Sign up">
        <AuthForm mode="sign-up" onDone={signedIn} />
        <p>
          Signed up before? <a href="/sign-in">Sign in</a>
        </p>
      </Page>
    );
  }

  if (path === "/sign-in" || !me) {
    return (
      <Page title="Sign in">
        <AuthForm mode="sign-in" onDone={signedIn} />
        <OAuthButtons />
        <p>
          New here? <a href="/sign-up">Sign up</a>
        </p>
      </Page>
    );
  }

  return (
    <Page title="Clankerboard">
      <p>
        Signed in as <strong>{me.user.name}</strong> ({me.user.email})
      </p>
      <button
        type="button"
        onClick={async () => {
          await api("/api/auth/sign-out", { method: "POST", body: "{}" });
          setMe(null);
          navigate("/sign-in");
        }}
      >
        Sign out
      </button>
      <CompanyHome />
    </Page>
  );
}

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="page">
      <h1>{title}</h1>
      {children}
    </main>
  );
}
