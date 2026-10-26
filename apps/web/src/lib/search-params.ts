import { defaultStringifySearch } from "@tanstack/react-router";

/**
 * The router's own search format, except that a list is a repeated param
 * (`?type=bug&type=story`) rather than JSON, so a filtered board's link stays
 * readable. The router's default parser already reads repeats back as a list.
 */
export function stringifySearch(search: Record<string, unknown>) {
  const single = Object.fromEntries(Object.entries(search).filter(([, v]) => !Array.isArray(v)));
  const params = new URLSearchParams(defaultStringifySearch(single));
  for (const [key, value] of Object.entries(search)) {
    if (Array.isArray(value)) for (const item of value) params.append(key, String(item));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}
