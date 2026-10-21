import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api, type Companies, errorMessage, type IssuedInvite, type Role } from "./api";

export function CompanyHome() {
  const [data, setData] = useState<Companies | null>(null);

  const refresh = useCallback(() => {
    api<Companies>("/api/companies").then(setData);
  }, []);
  useEffect(refresh, [refresh]);

  if (!data) return null;
  const active = data.companies.find((c) => c.id === data.activeCompanyId);

  return (
    <section className="stack">
      {data.companies.length > 1 && (
        <label>
          Company
          <select
            value={data.activeCompanyId ?? ""}
            onChange={async (e) => {
              await api("/api/active-company", {
                method: "PUT",
                body: JSON.stringify({ companyId: e.target.value }),
              });
              refresh();
            }}
          >
            {!active && <option value="">Pick a company</option>}
            {data.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {active ? (
        <>
          <h2>{active.name}</h2>
          <p>Your role: {active.role}</p>
          {(active.role === "owner" || active.role === "admin") && (
            <InviteForm role={active.role} />
          )}
        </>
      ) : (
        <CreateCompany onCreated={refresh} />
      )}
    </section>
  );
}

function CreateCompany({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/api/companies", { method: "POST", body: JSON.stringify({ name }) });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h2>Create a company</h2>
      <label>
        Company name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit">Create company</button>
    </form>
  );
}

function InviteForm({ role: actorRole }: { role: Role }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [issued, setIssued] = useState<IssuedInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCopied(false);
    try {
      setIssued(
        await api<IssuedInvite>("/api/invites", {
          method: "POST",
          body: JSON.stringify({ email, role }),
        }),
      );
      setEmail("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h3>Invite someone</h3>
      <label>
        Invite email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
          {actorRole === "owner" && <option value="owner">Owner</option>}
        </select>
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit">Create invite</button>
      {issued && (
        <div className="stack">
          <label>
            Invite link for {issued.invite.email}
            <input readOnly value={issued.link} onFocus={(e) => e.target.select()} />
          </label>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(issued.link);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          {issued.emailed && <p>We also emailed the link.</p>}
        </div>
      )}
    </form>
  );
}
