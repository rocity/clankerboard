import { schema } from "@clankerboard/db";
import type { DomainDeps } from "./context";
import { hasUsableInvite } from "./invites";

export type SignUpAttempt = {
  email: string;
  /** The token from an Invite link, when the person arrived through one. */
  inviteToken?: string;
};

/**
 * The first User on an empty instance can always sign up. After that, sign-up
 * needs open sign-up or a live Invite for the same email.
 */
export async function isSignUpAllowed(
  deps: Pick<DomainDeps, "db" | "clock" | "config">,
  attempt: SignUpAttempt,
): Promise<boolean> {
  if (deps.config.openSignup) return true;
  if (attempt.inviteToken && (await hasUsableInvite(deps, attempt.inviteToken, attempt.email))) {
    return true;
  }
  const [anyUser] = await deps.db.select({ id: schema.users.id }).from(schema.users).limit(1);
  return !anyUser;
}
