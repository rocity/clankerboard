import {
  type ActivityEvent,
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

  constructor(private readonly deps: DomainDeps) {}

  /** Starts pushing the Company's Activity to `sink`, as `ctx` may see it. */
  open(ctx: CompanyContext, sink: StreamSink, log: Logger): LiveStream {
    const stream = new LiveStream(this.deps, ctx, sink, log, () => this.streams.delete(stream));
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
      this.enqueue(() => this.send(event)),
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
