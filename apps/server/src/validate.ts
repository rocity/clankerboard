import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";

/** Validates a JSON body, answering with the first issue as plain copy. */
export function json<T extends ZodType>(schema: T) {
  return zValidator("json", schema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: result.error.issues[0]?.message ?? "Check the form and try again." },
        400,
      );
    }
  });
}
