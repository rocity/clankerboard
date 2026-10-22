import { createAuthClient } from "better-auth/react";

// Sign-in, sign-up, sign-out, and the session only. Companies, Roles, and Invites
// go through the Hono client in api.ts: the server blocks Better Auth's
// organization endpoints on purpose.
export const authClient = createAuthClient({ baseURL: window.location.origin });
