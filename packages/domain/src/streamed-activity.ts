import type { StreamedActivity } from "@clankerboard/shared";
import type { ActivityEvent } from "./activity";
import { type ActorView, resolveActors } from "./actors";
import type { CompanyContext, DomainDeps } from "./context";
import { DomainError } from "./errors";
import { canSeeActivity } from "./permissions";
import { findTicketById, ticketView } from "./ticket-store";

export type { StreamedActivity };

/**
 * An Activity as one subscriber's live stream sends it, with the Ticket as
 * that subscriber reads it now. Null when they may not see it, or when its
 * Ticket is gone (its `ticket.deleted` Activity follows).
 */
export async function streamedActivity(
  { db }: DomainDeps,
  ctx: CompanyContext,
  event: ActivityEvent,
): Promise<StreamedActivity | null> {
  if (!canSeeActivity(ctx, event)) return null;
  let ticket: StreamedActivity["ticket"] = null;
  if (event.ticketId) {
    try {
      // The Company-scoped read REST uses, so both answer who may see a Ticket alike.
      ticket = await ticketView(db, await findTicketById(db, ctx, event.ticketId));
    } catch (error) {
      if (error instanceof DomainError && error.kind === "not_found") return null;
      throw error;
    }
  }
  const actor = (await resolveActors(db, [event.actor]))(event.actor) as ActorView;
  return {
    activity: {
      id: event.id,
      kind: event.kind,
      projectId: event.projectId,
      ticketKey: event.ticketKey,
      actor,
      payload: event.payload,
      createdAt: event.createdAt,
    },
    ticket,
  };
}
