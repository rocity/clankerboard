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
