import type { Db } from "@clankerboard/db";
import { schema } from "@clankerboard/db";

export type SignUpPolicy = {
  /** When true, anyone who can reach the instance may sign up. */
  openSignup: boolean;
};

export type SignUpAttempt = {
  email: string;
};

/**
 * The first User on an empty instance can always sign up. After that, sign-up
 * needs open sign-up to be enabled.
 */
export async function isSignUpAllowed(
  db: Db,
  policy: SignUpPolicy,
  _attempt: SignUpAttempt,
): Promise<boolean> {
  if (policy.openSignup) return true;
  const [anyUser] = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  return !anyUser;
}
