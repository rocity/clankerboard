import { type FormEvent, useState } from "react";
import { api, errorMessage } from "./api";

type Props = {
  mode: "sign-in" | "sign-up";
  email?: string;
  headers?: Record<string, string>;
  onDone: () => void;
};

export function AuthForm({ mode, email: fixedEmail, headers, onDone }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(fixedEmail ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = mode === "sign-up" ? { name, email, password } : { email, password };
      await api(`/api/auth/${mode}/email`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      {mode === "sign-up" && (
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
      )}
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          readOnly={fixedEmail !== undefined}
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {mode === "sign-up" ? "Sign up" : "Sign in"}
      </button>
    </form>
  );
}
