// Helpers for writing user-facing copy. Not part of the domain module's public surface.

/** "CB-1", "CB-1 and CB-2", "CB-1, CB-2, and CB-3". */
export function listInWords(items: string[]) {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}
