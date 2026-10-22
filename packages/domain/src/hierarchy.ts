import { parentTypesAllowed as parentsAllowed, type TicketType } from "@agentkanban/shared";
import { invalid } from "./errors";

const withArticle = (type: TicketType) => `${type === "epic" ? "an" : "a"} ${type}`;

type Placed = { type: TicketType; projectId: string };

/** Throws a plain validation error if `child` can't sit under `parent`. */
export function assertPlacement(child: Placed, parent: Placed | null) {
  if (!parent) return;
  if (child.type === "epic") throw invalid("An epic can't have a parent.");
  if (parent.projectId !== child.projectId) throw invalid("A parent must be in the same project.");
  if (!parentsAllowed[child.type].includes(parent.type)) {
    const text = `${withArticle(child.type)} can't sit under ${withArticle(parent.type)}.`;
    throw invalid(text.charAt(0).toUpperCase() + text.slice(1));
  }
}

/** Throws if a Ticket becoming `type` would leave any of its children invalid. */
export function assertChildrenAccept(
  type: TicketType,
  children: { key: string; type: TicketType }[],
) {
  for (const child of children) {
    if (!parentsAllowed[child.type].includes(type)) {
      throw invalid(
        `${child.key} is ${withArticle(child.type)} and can't sit under ${withArticle(type)}.`,
      );
    }
  }
}
