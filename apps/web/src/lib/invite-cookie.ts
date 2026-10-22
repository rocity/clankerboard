// The Invite token travels to the server in the `cb_invite` cookie, which OAuth
// sign-up needs because it arrives on a redirect. The cookie also brings the Invite
// page back to its Invite after the provider, so the token never goes into a
// callback URL (Better Auth stores that and echoes it in a redirect).
const name = "cb_invite";

/** Remembers the Invite token for the OAuth round trip. */
export function saveInviteCookie(token: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not in every browser yet.
  document.cookie = `${name}=${encodeURIComponent(token)}; path=/; max-age=3600; samesite=lax`;
}

/** The Invite token left by `saveInviteCookie`, or an empty string. */
export function readInviteCookie() {
  const found = document.cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name);
  return found?.[1] ? decodeURIComponent(found[1]) : "";
}

/** Forgets the Invite token once it is used. */
export function clearInviteCookie() {
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not in every browser yet.
  document.cookie = `${name}=; path=/; max-age=0`;
}
