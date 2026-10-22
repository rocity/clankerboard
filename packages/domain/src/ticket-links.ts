import { randomUUID } from "node:crypto";
import { type Db, schema, type Tx } from "@clankerboard/db";
import {
  type LinkTicketsInput,
  type TicketLinkView,
  type TicketLinkViewKind,
  ticketLinkViewKinds,
} from "@clankerboard/shared";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { type RecordActivity, withActivity } from "./activity";
import { type ActorView, actorColumns, refFromColumns, refOf, resolveActors } from "./actors";
import { watchBlocked } from "./blocked";
import type { CompanyContext, DomainDeps } from "./context";
import { conflict, invalid, notFound } from "./errors";
import { canSeeProject } from "./permissions";
import {
  findTicket,
  selectTickets,
  type TicketRow,
  ticketActivity,
  ticketKeyOf,
  tickets,
} from "./ticket-store";
import { listInWords } from "./words";

export type { TicketLinkView };

const { ticketLinks } = schema;
type LinkRow = typeof ticketLinks.$inferSelect;

/** The Link's kind as seen from `ticketId`, one of its two Tickets. */
function kindFrom(link: LinkRow, ticketId: string): TicketLinkViewKind {
  if (link.kind === "relates_to") return "relates_to";
  return link.fromTicketId === ticketId ? "blocks" : "blocked_by";
}

const otherTicketId = (link: LinkRow, ticketId: string) =>
  link.fromTicketId === ticketId ? link.toTicketId : link.fromTicketId;

/** `links` as seen from `ticketId`, each with the other Ticket it reaches. */
async function linkViews(
  db: Db | Tx,
  ctx: CompanyContext,
  ticketId: string,
  links: LinkRow[],
): Promise<TicketLinkView[]> {
  const otherIds = links.map((l) => otherTicketId(l, ticketId));
  const others = new Map(
    otherIds.length === 0
      ? []
      : (await selectTickets(db).where(inArray(tickets.id, otherIds)))
          .filter((row) => canSeeProject(ctx, row))
          .map((row) => [row.id, row]),
  );
  const creators = links.map((l) => refFromColumns(l.createdByUserId, l.createdByAgentId));
  const actor = await resolveActors(db, creators);
  const seen = links.flatMap((link, i) => {
    const other = others.get(otherTicketId(link, ticketId));
    return other ? [{ link, other, kind: kindFrom(link, ticketId), creator: creators[i] }] : [];
  });
  // Grouped by kind, then by Ticket Key within a group.
  seen.sort(
    (a, b) =>
      ticketLinkViewKinds.indexOf(a.kind) - ticketLinkViewKinds.indexOf(b.kind) ||
      a.other.projectKey.localeCompare(b.other.projectKey) ||
      a.other.number - b.other.number,
  );
  return seen.map(({ link, other, kind, creator }) => ({
    kind,
    key: ticketKeyOf(other),
    projectKey: other.projectKey,
    title: other.title,
    type: other.type,
    status: other.status,
    archived: other.archivedAt !== null,
    createdBy: actor(creator ?? null) as ActorView,
    createdAt: link.createdAt,
  }));
}

/**
 * Both Tickets by key, locked in id order so two changes to the same pair
 * can't deadlock. The second may be the first again, for a self-link.
 */
async function lockPair(
  tx: Tx,
  ctx: CompanyContext,
  key: string,
  targetKey: string,
): Promise<[TicketRow, TicketRow]> {
  const ids = [(await findTicket(tx, ctx, key)).id, (await findTicket(tx, ctx, targetKey)).id];
  const locked = new Map(
    (
      await selectTickets(tx)
        .where(inArray(tickets.id, ids))
        .orderBy(asc(tickets.id))
        .for("update", { of: tickets })
    ).map((row) => [row.id, row]),
  );
  const [ticket, target] = ids.map((id) => locked.get(id));
  if (!ticket || !target) throw notFound();
  return [ticket, target];
}

/** A Link in words, from `ticket`'s side unless it is a Blocks Link: "CB-3 already blocks CB-7". */
function describe(link: LinkRow, ticket: TicketRow, target: TicketRow) {
  if (link.kind === "relates_to") {
    return `${ticketKeyOf(ticket)} already relates to ${ticketKeyOf(target)}`;
  }
  const [blocker, blocked] = link.fromTicketId === ticket.id ? [ticket, target] : [target, ticket];
  return `${ticketKeyOf(blocker)} already blocks ${ticketKeyOf(blocked)}`;
}

/**
 * Refuses `blocker` blocks `blocked` when Blocks Links already lead from
 * `blocked` back to `blocker`, naming the shortest such chain.
 */
async function assertNoCycle(tx: Tx, ctx: CompanyContext, blocker: TicketRow, blocked: TicketRow) {
  const { rows } = await tx.execute<{ path: string[] }>(sql`
    with recursive chain (ticket_id, path) as (
      select ${ticketLinks.toTicketId}, array[${ticketLinks.fromTicketId}, ${ticketLinks.toTicketId}]
      from ${ticketLinks}
      where ${ticketLinks.companyId} = ${ctx.companyId}
        and ${ticketLinks.kind} = 'blocks'
        and ${ticketLinks.fromTicketId} = ${blocked.id}
      union all
      select l.to_ticket_id, chain.path || l.to_ticket_id
      from chain
      join ticket_links l on l.from_ticket_id = chain.ticket_id
      where l.company_id = ${ctx.companyId}
        and l.kind = 'blocks'
        and not l.to_ticket_id = any(chain.path)
    )
    select path from chain where ticket_id = ${blocker.id}
    order by cardinality(path)
    limit 1
  `);
  const path = rows[0]?.path;
  if (!path) return;
  const middleIds = path.slice(1, -1);
  const keys = new Map(
    middleIds.length === 0
      ? []
      : (await selectTickets(tx).where(inArray(tickets.id, middleIds))).map((row) => [
          row.id,
          ticketKeyOf(row),
        ]),
  );
  const through = listInWords(middleIds.map((id) => keys.get(id) ?? "another ticket"));
  throw conflict(
    `${ticketKeyOf(blocker)} can't block ${ticketKeyOf(blocked)} because ${ticketKeyOf(blocked)} already blocks ${ticketKeyOf(blocker)} through ${through}.`,
  );
}

/** Links `key` to `input.target`, recording `ticket.linked` on both Tickets. */
export async function linkTickets(
  deps: DomainDeps,
  ctx: CompanyContext,
  key: string,
  input: LinkTicketsInput,
): Promise<TicketLinkView> {
  return withActivity(deps, ctx, async (tx, record) => {
    const [ticket, target] = await lockPair(tx, ctx, key, input.target);
    if (ticket.id === target.id) throw invalid("A ticket can't be linked to itself.");
    for (const row of [ticket, target]) {
      if (row.archivedAt) throw conflict(`Restore ${ticketKeyOf(row)} before linking it.`);
    }
    const existing = await linkBetween(tx, ctx, ticket, target);
    if (existing) throw conflict(`${describe(existing, ticket, target)}.`);
    const [blocker, blocked] = input.kind === "blocked_by" ? [target, ticket] : [ticket, target];
    const recordFlips =
      input.kind === "relates_to" ? null : await watchBlocked(tx, [blocked.id], blocker);
    if (input.kind !== "relates_to") await assertNoCycle(tx, ctx, blocker, blocked);
    const creator = actorColumns(refOf(ctx.actor));
    // Relates to is stored once per pair, lesser id first by Postgres's own comparison.
    const [from, to] =
      input.kind === "relates_to"
        ? [sql`least(${ticket.id}, ${target.id})`, sql`greatest(${ticket.id}, ${target.id})`]
        : [blocker.id, blocked.id];
    const [inserted] = await tx
      .insert(ticketLinks)
      .values({
        id: randomUUID(),
        companyId: ctx.companyId,
        fromTicketId: from,
        toTicketId: to,
        kind: input.kind === "relates_to" ? "relates_to" : "blocks",
        createdByUserId: creator.userId,
        createdByAgentId: creator.agentId,
        createdAt: deps.clock.now(),
      })
      .returning();
    if (!inserted) throw new Error("ticket_links insert returned nothing");
    await recordBothSides(record, "ticket.linked", inserted, ticket, target);
    await recordFlips?.(record, "linked");
    const [view] = await linkViews(tx, ctx, ticket.id, [inserted]);
    if (!view) throw notFound();
    return view;
  });
}

/** The one Link between two Tickets, whatever its kind or direction, through the pair index. */
async function linkBetween(tx: Tx, ctx: CompanyContext, a: TicketRow, b: TicketRow) {
  const { fromTicketId: from, toTicketId: to } = ticketLinks;
  const [link] = await tx
    .select()
    .from(ticketLinks)
    .where(
      and(
        eq(ticketLinks.companyId, ctx.companyId),
        sql`least(${from}, ${to}) = least(${a.id}, ${b.id})`,
        sql`greatest(${from}, ${to}) = greatest(${a.id}, ${b.id})`,
      ),
    );
  return link ?? null;
}

/** Removes the Link between `key` and `targetKey`, whatever its kind, recording it on both. */
export async function unlinkTickets(
  deps: DomainDeps,
  ctx: CompanyContext,
  key: string,
  targetKey: string,
) {
  await withActivity(deps, ctx, async (tx, record) => {
    const [ticket, target] = await lockPair(tx, ctx, key, targetKey);
    const link = await linkBetween(tx, ctx, ticket, target);
    if (!link) throw notFound(`${ticketKeyOf(ticket)} and ${ticketKeyOf(target)} aren't linked.`);
    const [blocker, blocked] =
      link.fromTicketId === ticket.id ? [ticket, target] : [target, ticket];
    const recordFlips =
      link.kind === "blocks" ? await watchBlocked(tx, [blocked.id], blocker) : null;
    await tx.delete(ticketLinks).where(eq(ticketLinks.id, link.id));
    await recordBothSides(record, "ticket.unlinked", link, ticket, target);
    await recordFlips?.(record, "unlinked");
  });
}

async function recordBothSides(
  record: RecordActivity,
  kind: "ticket.linked" | "ticket.unlinked",
  link: LinkRow,
  ticket: TicketRow,
  target: TicketRow,
) {
  for (const [self, other] of [
    [ticket, target],
    [target, ticket],
  ] as const) {
    await record(
      ticketActivity(self, kind, { kind: kindFrom(link, self.id), ticket: ticketKeyOf(other) }),
    );
  }
}

/** Every Link of a Ticket: blocked by, then blocks, then relates to. */
export async function listLinks(
  { db }: DomainDeps,
  ctx: CompanyContext,
  key: string,
): Promise<TicketLinkView[]> {
  const ticket = await findTicket(db, ctx, key);
  const links = await db
    .select()
    .from(ticketLinks)
    .where(
      and(
        eq(ticketLinks.companyId, ctx.companyId),
        or(eq(ticketLinks.fromTicketId, ticket.id), eq(ticketLinks.toTicketId, ticket.id)),
      ),
    );
  return linkViews(db, ctx, ticket.id, links);
}
