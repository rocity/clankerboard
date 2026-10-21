export type ApiError = { status: number; message: string };

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) {
    const message = body?.error ?? body?.message ?? "Something went wrong.";
    throw { status: res.status, message } satisfies ApiError;
  }
  return body as T;
}

export function errorMessage(error: unknown) {
  return (error as ApiError)?.message ?? "Something went wrong.";
}

export type Me = { user: { id: string; name: string; email: string; image: string | null } };

export type Role = "owner" | "admin" | "member";
export type Company = { id: string; name: string; slug: string; role: Role };
export type Companies = { companies: Company[]; activeCompanyId: string | null };
export type IssuedInvite = {
  invite: { id: string; email: string; role: Role };
  link: string;
  emailed: boolean;
};
export type InvitePreview = {
  invite: {
    companyName: string;
    teamName: string | null;
    email: string;
    role: Role;
    inviterName: string;
  };
};
