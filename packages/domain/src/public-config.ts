import type { DomainDeps } from "./context";
import { isSignUpOpen } from "./sign-up";

export type PublicConfig = {
  /** The URL Agents reach this server at, for the setup snippets. */
  publicUrl: string;
  /** Whether anyone can sign up without an Invite. It says nothing about why. */
  signUpOpen: boolean;
};

/**
 * The settings a visitor may read before signing in. Add a field here only if
 * every visitor may see it: `signUpOpen` is true for open sign-up and for an
 * empty instance alike, so it does not tell whether any User exists.
 */
export async function getPublicConfig(
  deps: Pick<DomainDeps, "db" | "config">,
): Promise<PublicConfig> {
  return { publicUrl: deps.config.baseUrl, signUpOpen: await isSignUpOpen(deps) };
}
