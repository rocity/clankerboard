import type {
  ActivityEvent,
  ActivityListener,
  EventBus,
  Revocation,
  RevocationListener,
} from "./activity";

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
    // A copy, so a listener that unsubscribes or subscribes doesn't change this round.
    for (const listener of [...(this.listeners.get(event.companyId) ?? [])]) {
      try {
        listener(event);
      } catch (error) {
        this.onListenerError(error);
      }
    }
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
    for (const listener of [...this.revocationListeners]) {
      try {
        listener(revocation);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }

  subscribeRevocations(listener: RevocationListener) {
    const subscription: RevocationListener = (revocation) => listener(revocation);
    this.revocationListeners.add(subscription);
    return () => {
      this.revocationListeners.delete(subscription);
    };
  }
}
