export type DomainErrorKind = "not_found" | "forbidden" | "conflict" | "invalid";

/**
 * A rule the caller broke. The message is user-facing copy: short and plain.
 * Adapters map the kind to a status code.
 */
export class DomainError extends Error {
  constructor(
    readonly kind: DomainErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

// Not-found is also what a caller gets for anything in a Company they don't
// belong to, so existence never leaks across Companies.
export const notFound = () => new DomainError("not_found", "Not found.");
export const forbidden = (message = "You don't have permission to do that.") =>
  new DomainError("forbidden", message);
export const conflict = (message: string) => new DomainError("conflict", message);
export const invalid = (message: string) => new DomainError("invalid", message);
