import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { sessionExpired } from "./api";
import { activityKinds, applyLiveEvent, parseLiveEvent, resync } from "./live-events";
import { companiesQuery } from "./queries";

/**
 * - `connecting`: opening, or the browser is retrying a dropped connection.
 * - `live`: events are arriving.
 * - `elsewhere`: the session moved to another Company (another tab switched), or
 *   the User left this one. The stream is closed, because its events would belong
 *   to a Company this page does not show.
 */
export type StreamStatus = "connecting" | "live" | "elsewhere";

/** How long a page waits for the stream to open before it loads anyway. */
const openTimeoutMs = 3000;
const maxBackoffMs = 30_000;

/**
 * One EventSource for one Company. The browser reconnects a dropped connection
 * by itself and sends Last-Event-ID, so the server replays what was missed. What
 * the browser cannot do is recover from a refused connection: the EventSource
 * is then dead, so a new one is made after a growing pause. A new object has no
 * Last-Event-ID, so it refetches the board instead.
 */
class CompanyStream {
  status: StreamStatus = "connecting";
  private source: EventSource | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private stopped = false;
  /** The page may have missed events nothing will replay. Refetch once the stream is open. */
  private needsResync = false;
  /**
   * Whether this EventSource has received an event id. Only then does the browser
   * send Last-Event-ID when it reconnects, so only then can the server replay.
   */
  private hasEventId = false;
  /** The connection dropped since it was last checked: it may now belong to another Company. */
  private unverified = false;
  /** Events that arrived while the Company was being checked, in order. */
  private held: (() => void)[] | null = null;
  private opened: (() => void) | null = null;

  constructor(
    readonly companyId: string,
    private readonly queryClient: QueryClient,
    private readonly changed: () => void,
  ) {}

  /** Opens the stream. Resolves once it is open, or after a few seconds so the page still loads. */
  start() {
    const ready = new Promise<void>((resolve) => {
      this.opened = resolve;
      setTimeout(() => {
        if (this.opened !== resolve) return;
        // The page loads without the stream; whatever happens before it opens is not replayed.
        this.opened = null;
        this.needsResync = true;
        resolve();
      }, openTimeoutMs);
    });
    this.open();
    return ready;
  }

  stop() {
    this.stopped = true;
    this.source?.close();
    this.source = null;
    if (this.retry) clearTimeout(this.retry);
    this.opened?.();
    this.opened = null;
  }

  private setStatus(status: StreamStatus) {
    if (this.status === status) return;
    this.status = status;
    this.changed();
  }

  private open() {
    const source = new EventSource("/api/stream");
    this.source = source;
    this.hasEventId = false;
    source.addEventListener("open", () => this.onOpen(source));
    source.addEventListener("error", () => this.onError(source));
    const listen = (kind: string, handle: (data: unknown) => void) =>
      source.addEventListener(kind, (event) => {
        if ((event as MessageEvent).lastEventId) this.hasEventId = true;
        handle((event as MessageEvent).data);
      });
    for (const kind of activityKinds) {
      listen(kind, (data) => {
        const parsed = parseLiveEvent(data);
        if (parsed) this.receive(() => applyLiveEvent(this.queryClient, parsed));
      });
    }
    listen("resync", () => this.receive(() => resync(this.queryClient)));
    source.addEventListener("unauthorized", () => {
      this.stop();
      sessionExpired();
    });
  }

  /** Applies an event now, or after the Company check when the connection was just re-made. */
  private receive(apply: () => void) {
    if (this.held) this.held.push(apply);
    else apply();
  }

  private async onOpen(source: EventSource) {
    if (source !== this.source) return;
    this.failures = 0;
    this.opened?.();
    this.opened = null;
    if (this.unverified) {
      // A connection that never received an id sends no Last-Event-ID when it
      // comes back, so the server has nothing to replay from.
      if (!this.hasEventId) this.needsResync = true;
      this.held = [];
      const where = await this.checkCompany();
      if (this.stopped || source !== this.source) return;
      const held = this.held;
      this.held = null;
      if (where === "elsewhere") return this.leave();
      if (where === "unknown") return this.reconnect(source);
      this.unverified = false;
      for (const apply of held) apply();
    }
    if (this.needsResync) {
      this.needsResync = false;
      resync(this.queryClient);
    }
    this.setStatus("live");
  }

  private onError(source: EventSource) {
    if (source !== this.source) return;
    this.unverified = true;
    this.setStatus("connecting");
    // The browser retries a dropped connection on its own. A refused one (a
    // non-200 answer) leaves the object closed for good.
    if (source.readyState === EventSource.CLOSED) this.reconnect(source);
  }

  /** Replaces a dead EventSource after a pause that grows with each failure. */
  private reconnect(dead: EventSource) {
    dead.close();
    this.needsResync = true;
    this.unverified = true;
    this.failures += 1;
    const pause = Math.min(maxBackoffMs, 1000 * 2 ** (this.failures - 1));
    this.retry = setTimeout(async () => {
      if (this.stopped) return;
      // A 401 here goes through the shared handler and ends in the sign-in page.
      const where = await this.checkCompany();
      if (this.stopped) return;
      if (where === "elsewhere") return this.leave();
      this.open();
    }, pause);
  }

  /** Whether the session's active Company is still this stream's. */
  private async checkCompany(): Promise<"same" | "elsewhere" | "unknown"> {
    try {
      const data = await this.queryClient.fetchQuery({ ...companiesQuery, staleTime: 0 });
      return data.activeCompanyId === this.companyId ? "same" : "elsewhere";
    } catch {
      return "unknown";
    }
  }

  private leave() {
    this.stop();
    this.setStatus("elsewhere");
  }
}

let current: CompanyStream | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

/**
 * Makes sure this tab has a stream for the Company, and resolves once it is
 * open. Open it before fetching, and nothing that happens in between is missed.
 * Calling it again for the same Company changes nothing; for another Company it
 * closes the old stream first, since the old one's ids mean nothing there.
 */
export function ensureStream(queryClient: QueryClient, companyId: string) {
  if (current?.companyId === companyId && current.status !== "elsewhere") return Promise.resolve();
  current?.stop();
  current = new CompanyStream(companyId, queryClient, notify);
  notify();
  return current.start();
}

/** Whether the stream for this Company is open and its Company was checked. */
export function isStreamLive(companyId: string) {
  return current?.companyId === companyId && current.status === "live";
}

/** Closes the tab's stream. With a Company, only if that is the one open. */
export function stopStream(companyId?: string) {
  if (!current || (companyId && current.companyId !== companyId)) return;
  current.stop();
  current = null;
  notify();
}

const idle: StreamStatus = "connecting";

export function useStreamStatus() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current?.status ?? idle,
  );
}
