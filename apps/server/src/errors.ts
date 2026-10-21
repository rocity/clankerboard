import { DomainError } from "@clankerboard/domain";
import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "./env";

const statusByKind: Record<DomainError["kind"], ContentfulStatusCode> = {
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  invalid: 400,
  gone: 410,
};

export const handleError: ErrorHandler<AppEnv> = (error, c) => {
  if (error instanceof DomainError)
    return c.json({ error: error.message }, statusByKind[error.kind]);
  (c.var.log ?? console).error({ err: error }, "unhandled error");
  return c.json({ error: "Something went wrong." }, 500);
};
