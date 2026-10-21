import type { Clock } from "@clankerboard/domain";

export type RateLimitConfig = {
  /** Requests a key may make in a burst. */
  capacity: number;
  /** Requests a key earns back per second. */
  refillPerSecond: number;
};

type Bucket = { tokens: number; updatedAt: number };

/**
 * An in-memory token bucket per key. Per process, which is fine for a single
 * deployable (ADR-0001).
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly config: RateLimitConfig,
    private readonly clock: Clock,
  ) {}

  /** Spends one token. Returns the seconds to wait when none is left. */
  take(key: string): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const now = this.clock.now().getTime();
    const { capacity, refillPerSecond } = this.config;
    const bucket = this.buckets.get(key) ?? { tokens: capacity, updatedAt: now };
    bucket.tokens = Math.min(
      capacity,
      bucket.tokens + ((now - bucket.updatedAt) / 1000) * refillPerSecond,
    );
    bucket.updatedAt = now;
    this.buckets.set(key, bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true };
    }
    return { allowed: false, retryAfterSeconds: Math.ceil((1 - bucket.tokens) / refillPerSecond) };
  }
}
