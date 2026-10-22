import type { QueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./api";
import { isStreamLive, stopStream } from "./live-stream";
import { clearCompanyData, companiesQuery } from "./queries";

const lastCompanyKey = "clankerboard-last-company";

/** The slug of the Company this browser used last. */
export function rememberCompany(slug: string) {
  try {
    localStorage.setItem(lastCompanyKey, slug);
  } catch {
    // Storage can be blocked. The server's active Company still decides.
  }
}

export function rememberedCompany() {
  try {
    return localStorage.getItem(lastCompanyKey);
  } catch {
    return null;
  }
}

/** Where `/` lands: the session's active Company, else this browser's last one, else the first. */
export function pickLandingCompany(data: {
  companies: { id: string; slug: string }[];
  activeCompanyId: string | null;
}) {
  const remembered = rememberedCompany();
  return (
    data.companies.find((c) => c.id === data.activeCompanyId) ??
    data.companies.find((c) => c.slug === remembered) ??
    data.companies[0]
  );
}

let activeSlug: string | null = null;

/**
 * Makes the Company at `slug` the session's active one, since every Company
 * route reads the active Company from the session, not from the URL. Returns
 * null when the User is not in a Company with that slug.
 */
export async function activateCompany(queryClient: QueryClient, slug: string) {
  // Moving between pages of the Company already shown asks nothing. A live stream for it
  // means the session has not moved: another tab's switch ends the stream, and the next
  // visit (stream no longer live) re-asserts this Company below.
  const known = queryClient
    .getQueryData(companiesQuery.queryKey)
    ?.companies.find((c) => c.slug === slug);
  if (known && activeSlug === slug && isStreamLive(known.id)) {
    rememberCompany(slug);
    return known;
  }
  const data = await queryClient.fetchQuery({ ...companiesQuery, staleTime: 0 });
  const company = data.companies.find((c) => c.slug === slug);
  if (!company) return null;
  if (data.activeCompanyId !== company.id) {
    await unwrap(api["active-company"].$put({ json: { companyId: company.id } }));
  }
  if (activeSlug !== slug) {
    clearCompanyData(queryClient);
    activeSlug = slug;
  }
  rememberCompany(slug);
  return company;
}

/** Forget which Company was active, for sign-out and session expiry. */
export function resetActiveCompany() {
  activeSlug = null;
  stopStream();
}
