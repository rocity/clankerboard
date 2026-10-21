import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import type { ZodType } from "zod";

type Result = { success: true } | { success: false; error: { issues: { message: string }[] } };

/** Answers a failed validation with its first issue as plain copy. */
function firstIssue(result: Result, c: Context) {
  if (!result.success) {
    return c.json(
      { error: result.error.issues[0]?.message ?? "Check the request and try again." },
      400,
    );
  }
}

/** Validates a JSON body. */
export function json<T extends ZodType>(schema: T) {
  return zValidator("json", schema, firstIssue);
}

/** Validates query parameters. */
export function query<T extends ZodType>(schema: T) {
  return zValidator("query", schema, firstIssue);
}
