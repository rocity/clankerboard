const units: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: "year", seconds: 365 * 24 * 60 * 60 },
  { unit: "month", seconds: 30 * 24 * 60 * 60 },
  { unit: "week", seconds: 7 * 24 * 60 * 60 },
  { unit: "day", seconds: 24 * 60 * 60 },
  { unit: "hour", seconds: 60 * 60 },
  { unit: "minute", seconds: 60 },
];

const formatter = new Intl.RelativeTimeFormat("en", { numeric: "always" });

/** "just now", "5 minutes ago", "3 days ago". Takes an ISO string as the API sends it. */
export function timeAgo(iso: string, now: Date = new Date()) {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "just now";
  for (const { unit, seconds: size } of units) {
    if (seconds >= size) return formatter.format(-Math.floor(seconds / size), unit);
  }
  return formatter.format(-1, "minute");
}

/** The exact time, for a tooltip. */
export function exactTime(iso: string) {
  return new Date(iso).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
}
