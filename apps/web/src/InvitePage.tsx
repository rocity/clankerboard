import { useEffect, useState } from "react";
import { AuthForm } from "./AuthForm";
import { api, errorMessage, type InvitePreview, type Me } from "./api";
import { OAuthButtons } from "./OAuthButtons";

type Props = {
  me: Me | null;
  onJoined: () => void;
};

// The token lives in the URL fragment, so it never reaches server logs.
export function InvitePage({ me, onJoined }: Props) {
  const token = window.location.hash.slice(1);
  const [preview, setPreview] = useState<InvitePreview["invite"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"sign-up" | "sign-in">("sign-up");

  useEffect(() => {
    api<InvitePreview>("/api/invite-links/lookup", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then((res) => setPreview(res.invite))
      .catch((err) => setError(errorMessage(err)));
  }, [token]);

  async function accept() {
    try {
      await api("/api/invite-links/accept", { method: "POST", body: JSON.stringify({ token }) });
      // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not in every browser yet.
      document.cookie = "cb_invite=; path=/; max-age=0";
      onJoined();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (error) {
    return (
      <p role="alert" className="error">
        {error}
      </p>
    );
  }
  if (!preview) return null;

  return (
    <div className="stack">
      <p>
        {preview.inviterName} invited you to join{" "}
        {preview.teamName ? (
          <>
            the {preview.teamName} team at <strong>{preview.companyName}</strong>.
          </>
        ) : (
          <>
            <strong>{preview.companyName}</strong> as {preview.role}.
          </>
        )}
      </p>
      {me ? (
        <button type="button" onClick={accept}>
          Accept invite
        </button>
      ) : (
        <>
          <AuthForm
            mode={mode}
            email={preview.email}
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
          <button
            type="button"
            className="link"
            onClick={() => setMode(mode === "sign-up" ? "sign-in" : "sign-up")}
          >
            {mode === "sign-up" ? "I've signed up before" : "I'm new here"}
          </button>
        </>
      )}
    </div>
  );
}
