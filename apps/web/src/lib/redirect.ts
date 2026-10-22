import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { sessionQuery } from "./queries";

/**
 * Accepts only a path on this site, so a crafted `?redirect=` cannot send
 * someone to another origin after sign-in.
 */
export function safeRedirect(value: unknown) {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  return value;
}

/** Pages that do not need a session. */
const publicPaths = ["/sign-in", "/sign-up", "/invite"];

export function isPublicPath(pathname: string) {
  return publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** For a route's `beforeLoad`: sends a signed-out visitor to sign-in, then back to `location`. */
export async function requireSession(queryClient: QueryClient, location: { href: string }) {
  const user = await queryClient.ensureQueryData(sessionQuery);
  if (!user) throw redirect({ to: "/sign-in", search: { redirect: location.href } });
  return user;
}
