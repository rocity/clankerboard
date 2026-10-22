/** Field-by-field differences, as recorded in "updated" Activity. */
export type Changes = Record<string, { from: unknown; to: unknown }>;

/** The fields of `input` that differ from `current`, as from/to pairs. */
export function changedFields<T extends object>(current: T, input: Partial<T>): Changes {
  const changes: Changes = {};
  for (const [field, to] of Object.entries(input)) {
    const from = current[field as keyof T];
    if (to !== undefined && to !== from) changes[field] = { from, to };
  }
  return changes;
}
