import {
  type ActivityEvent,
  activityBacklog,
  type CompanyContext,
  type DomainDeps,
  streamedActivity,
} from "@clankerboard/domain";
import type { Logger } from "../logger";

/** How often an idle stream sends a comment, so proxies don't time it out. */
export const keepaliveMs = 20_000;

/** Where one open stream writes. The route backs it with an SSE response. */
export type StreamSink = {
  event(message: { id: string; event: string; data: string }): Promise<void>;
  comment(text: string): Promise<void>;
};

/**
 * Every open live stream in this process. Each stream subscribes to its
 * Company on the event bus and sends what its Actor may see, in order.
 */
export class StreamManager {
  private readonly streams = new Set<LiveStream>();

  constructor(
    private readonly deps: DomainDeps,
    private readonly options: { backlogLimit: number },
  ) {}

  /**
   * Starts pushing the Company's Activity to `sink`, as `ctx` may see it.
   * With `lastEventId`, first sends what came after it.
   */
  open(ctx: CompanyContext, sink: StreamSink, log: Logger, lastEventId?: string): LiveStream {
    const stream = new LiveStream(this.deps, ctx, sink, log, () => this.streams.delete(stream));
    if (lastEventId) stream.catchUp(lastEventId, this.options.backlogLimit);
    this.streams.add(stream);
    return stream;
  }

  /** Ends every open stream, so the server can stop. */
  closeAll() {
    for (const stream of [...this.streams]) stream.close();
  }
}

export class LiveStream {
  /** Resolves once the stream is closed, from either end. */
  readonly closed: Promise<void>;
  private resolveClosed: () => void = () => {};
  private ended = false;
  // Every write goes through this chain, so events leave in publish order even
  // though each one is read from the database first.
  private queue: Promise<void> = Promise.resolve();
  private readonly unsubscribe: () => void;
  private readonly stopTicking: () => void;
  // The last id the catch-up sent. Live events up to it are duplicates.
  private caughtUpThrough = 0;

  constructor(
    private readonly deps: DomainDeps,
    readonly ctx: CompanyContext,
    private readonly sink: StreamSink,
    private readonly log: Logger,
    private readonly onClose: () => void,
  ) {
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    this.unsubscribe = deps.events.subscribe(ctx.companyId, (event) =>
      this.enqueue(() => this.sendLive(event)),
    );
    this.stopTicking = deps.clock.every(keepaliveMs, () => this.enqueue(() => this.tick()));
  }

  close() {
    if (this.ended) return;
    this.ended = true;
    this.unsubscribe();
    this.stopTicking();
    this.onClose();
    this.resolveClosed();
  }

  /**
   * Sends the Activity after `lastEventId` from the database, ahead of every
   * live event queued behind it, or a single `resync` event when there is too
   * much of it. Called right after subscribing, so nothing published in
   * between is missed.
   */
  catchUp(lastEventId: string, backlogLimit: number) {
    // Anything but an Activity id leaves the client's position unknown.
    const afterId = /^\d{1,15}$/.test(lastEventId) ? Number(lastEventId) : null;
    this.enqueue(async () => {
      const backlog = await activityBacklog(this.deps, this.ctx, afterId, backlogLimit);
      if (backlog.kind === "refetch") {
        // The client refetches everything up to here, so the id is where its
        // next reconnect resumes, and live events up to it are covered.
        await this.sink.event({ id: String(backlog.latestId), event: "resync", data: "{}" });
        this.caughtUpThrough = backlog.latestId;
        return;
      }
      for (const event of backlog.events) {
        await this.send(event);
        this.caughtUpThrough = event.id;
      }
    });
  }

  private async sendLive(event: ActivityEvent) {
    // Committed before the backlog was read, so the backlog already sent it.
    if (event.id <= this.caughtUpThrough) return;
    await this.send(event);
  }

  private enqueue(task: () => Promise<void>) {
    this.queue = this.queue.then(async () => {
      if (this.ended) return;
      try {
        await task();
      } catch (error) {
        // Closing beats skipping: a reconnecting client can catch up, a
        // silently dropped event is lost.
        this.log.error({ err: error }, "live stream failed");
        this.close();
      }
    });
  }

  private async tick() {
    await this.sink.comment("keepalive");
  }

  private async send(event: ActivityEvent) {
    const data = await streamedActivity(this.deps, this.ctx, event);
    if (!data || this.ended) return;
    await this.sink.event({ id: String(event.id), event: event.kind, data: JSON.stringify(data) });
  }
}
