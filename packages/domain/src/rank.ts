import { generateKeyBetween } from "fractional-indexing";

/**
 * A rank that sorts right before `column[index]` (or at the end when `index`
 * is past it). `column` is the target column's ranks in order, without the
 * Ticket being placed. Equal ranks can exist after concurrent writes, so the
 * upper bound skips past any tie.
 */
export function rankAt(column: string[], index: number) {
  const lower = column[index - 1] ?? null;
  let upper = column[index] ?? null;
  if (lower !== null && upper !== null && upper <= lower) {
    upper = column.find((rank) => rank > lower) ?? null;
  }
  return generateKeyBetween(lower, upper);
}
