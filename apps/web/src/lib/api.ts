import type { AppType } from "@clankerboard/server";
import { hc } from "hono/client";
import type { ClientErrorStatusCode, ServerErrorStatusCode } from "hono/utils/http-status";

/** A failed API call, carrying the plain message the server sent. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let handleUnauthorized: () => void = () => {};

/** Called when any call answers 401, which means the session has expired. */
export function onUnauthorized(handler: () => void) {
  handleUnauthorized = handler;
}

/** For the live stream, which learns of an expired session from an event, not from a call. */
export function sessionExpired() {
  handleUnauthorized();
}

// `hc` types every route under /api from the server's own route definitions.
const client = hc<AppType>("/", {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetch(input, { ...init, credentials: "same-origin" });
    if (res.status === 401) handleUnauthorized();
    return res;
  },
});

export const api = client.api;

type FailureStatus = ClientErrorStatusCode | ServerErrorStatusCode;

/** The JSON body types of the answers that are not failures (an error status is dropped). */
type Successful<R> = R extends { status: infer Status; json: () => Promise<infer Body> }
  ? Status extends FailureStatus
    ? never
    : Body
  : never;

/** Resolves with the JSON body of a 2xx answer, and throws an ApiError for anything else. */
export async function unwrap<R extends { ok: boolean; status: number }>(
  call: Promise<R>,
): Promise<Successful<R>> {
  const res = (await call) as R & Response;
  if (!res.ok) throw new ApiError(res.status, await errorBody(res));
  if (res.status === 204) return undefined as Successful<R>;
  return (await res.json()) as Successful<R>;
}

async function errorBody(res: Response) {
  const fallback = "Something went wrong.";
  if (!res.headers.get("content-type")?.includes("json")) return fallback;
  // Our routes answer { error }; Better Auth answers { message }.
  const body = (await res.json().catch(() => null)) as {
    error?: unknown;
    message?: unknown;
  } | null;
  const message = body?.error ?? body?.message;
  return typeof message === "string" && message ? message : fallback;
}

export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : "Something went wrong.";
}
