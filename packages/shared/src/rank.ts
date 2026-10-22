import { generateKeyBetween } from "fractional-indexing";

/**
 * A rank that sorts right before `ranks[index]` (or at the end when `index`
 * is past it). `ranks` are the target Status's ranks in order, without the
 * Ticket being placed. Equal ranks can exist after concurrent writes, so the
 * upper bound skips past any tie.
 */
export function rankAt(ranks: string[], index: number) {
  const lower = ranks[index - 1] ?? null;
  let upper = ranks[index] ?? null;
  if (lower !== null && upper !== null && upper <= lower) {
    upper = ranks.find((rank) => rank > lower) ?? null;
  }
  return generateKeyBetween(lower, upper);
}
