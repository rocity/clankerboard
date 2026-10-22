export type Clock = {
  now(): Date;
  /** Calls `callback` every `ms` milliseconds until the returned function is called. */
  every(ms: number, callback: () => void): () => void;
};

export const systemClock: Clock = {
  now: () => new Date(),
  every: (ms, callback) => {
    const interval = setInterval(callback, ms);
    return () => clearInterval(interval);
  },
};
