import { z } from "zod";

/** The colors a Label can have. Each reads in both the light and the dark theme. */
export const labelColors = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;
export type LabelColor = (typeof labelColors)[number];

export const labelColor = z.enum(labelColors, { error: "Pick one of the label colors." });

/** Label names match without regard to case or surrounding spaces. */
export const normalizeLabelName = (name: string) => name.trim().toLowerCase();

/**
 * The color a new Label starts with, from its name, so the same name always
 * starts the same color wherever it is first applied.
 */
export function defaultLabelColor(name: string): LabelColor {
  let hash = 0;
  for (const char of normalizeLabelName(name)) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return labelColors[hash % labelColors.length] as LabelColor;
}

export const maxLabelsPerTicket = 10;

export const labelName = z
  .string({ error: "Enter a label name." })
  .trim()
  .min(1, { error: "Enter a label name." })
  .max(30, { error: "Label names can be up to 30 characters." });

const labelsError = `A ticket can have up to ${maxLabelsPerTicket} labels.`;

/** A Ticket's whole set of Labels, by name. A repeat in any case counts once, as first spelled. */
export const ticketLabels = z
  .array(labelName, { error: "Labels are a list of names." })
  .transform((names) => {
    const seen = new Set<string>();
    return names.filter((name) => {
      const normalized = normalizeLabelName(name);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  })
  .refine((names) => names.length <= maxLabelsPerTicket, { error: labelsError });

export const updateLabelInput = z.object({
  name: labelName.optional(),
  color: labelColor.optional(),
});
export type UpdateLabelInput = z.infer<typeof updateLabelInput>;
