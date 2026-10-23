/** A Sprint's states, in the order it goes through them. A Project has at most one active Sprint. */
export const sprintStates = ["planned", "active", "finished"] as const;
export type SprintState = (typeof sprintStates)[number];
