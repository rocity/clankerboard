import { useSyncExternalStore } from "react";

/** How long a Ticket that someone else changed stays marked. */
export const highlightMs = 2400;

// Ticket Key -> a number that grows with each change, so a second change while
// the mark is still showing restarts it. Kept outside React because a Ticket
// can change before it is on screen (it moves into a Status).
const marks = new Map<string, number>();
const listeners = new Set<() => void>();
let counter = 0;

function notify() {
  for (const listener of listeners) listener();
}

/** Marks a Ticket as just changed by someone else. The mark clears itself. */
export function highlightTicket(key: string) {
  const mark = ++counter;
  marks.set(key, mark);
  notify();
  setTimeout(() => {
    if (marks.get(key) !== mark) return;
    marks.delete(key);
    notify();
  }, highlightMs);
}

/** The current mark of a Ticket, or undefined when it was not changed lately. */
export function useHighlight(key: string) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => marks.get(key),
  );
}
