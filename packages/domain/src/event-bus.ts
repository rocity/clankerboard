import type { ActivityEvent } from "./activity";
import type { Revocation } from "./revocation";

export type ActivityListener = (event: ActivityEvent) => void;

export type RevocationListener = (revocation: Revocation) => void;

/**
 * Where Activity and Revocations go after their transaction commits, and
 * where the live stream reads them from. The in-process bus is the v1
 * implementation; one backed by Postgres LISTEN/NOTIFY can replace it without
 * changing either side.
 */
export type EventBus = {
  publish(event: ActivityEvent): void;
  /**
   * Calls `listener` with each Activity of the Company published from now on,
   * in publish order. Returns the function that unsubscribes it.
   */
  subscribe(companyId: string, listener: ActivityListener): () => void;
  publishRevocation(revocation: Revocation): void;
  /** Calls `listener` with every Revocation, in any Company, from now on. */
  subscribeRevocations(listener: RevocationListener): () => void;
};

/**
 * The v1 event bus: fans Activity out to subscribers in the same process.
 * Listeners run synchronously inside `publish`, so they must only hand the
 * event off. One that throws is reported and the others still run, because
 * the change it describes has already committed.
 */
export class InProcessEventBus implements EventBus {
  private readonly listeners = new Map<string, Set<ActivityListener>>();
  private readonly revocationListeners = new Set<RevocationListener>();

  constructor(private readonly onListenerError: (error: unknown) => void = () => {}) {}

  publish(event: ActivityEvent) {
    this.notify(this.listeners.get(event.companyId), event);
  }

  subscribe(companyId: string, listener: ActivityListener) {
    let company = this.listeners.get(companyId);
    if (!company) {
      company = new Set();
      this.listeners.set(companyId, company);
    }
    // Wrapped, so one listener subscribed twice gets two independent subscriptions.
    const subscription: ActivityListener = (event) => listener(event);
    company.add(subscription);
    return () => {
      company.delete(subscription);
      if (company.size === 0 && this.listeners.get(companyId) === company) {
        this.listeners.delete(companyId);
      }
    };
  }

  publishRevocation(revocation: Revocation) {
    this.notify(this.revocationListeners, revocation);
  }

  subscribeRevocations(listener: RevocationListener) {
    const subscription: RevocationListener = (revocation) => listener(revocation);
    this.revocationListeners.add(subscription);
    return () => {
      this.revocationListeners.delete(subscription);
    };
  }

  private notify<T>(listeners: Set<(message: T) => void> | undefined, message: T) {
    // A copy, so a listener that unsubscribes or subscribes doesn't change this round.
    for (const listener of [...(listeners ?? [])]) {
      try {
        listener(message);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }
}
