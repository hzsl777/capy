// Both or neither (decision 90): a contested place shows its local outlets only while each side has a story that day.
import type { Source } from "@2dayai/core";

export type Held = { group: string; missing: string[] };

/**
 * The balance groups to leave out of a day, given how many of the day's articles each source has. A group is held
 * when any of its sides has no article; then every source in it is held, whichever side it is on.
 */
export function heldGroups(sources: Source[], articlesBySource: Map<string, number>): { held: Held[]; heldSources: Set<string> } {
  const groups = new Map<string, Map<string, number>>();
  for (const s of sources) {
    if (!s.balance) continue;
    const sides = groups.get(s.balance.group) ?? new Map<string, number>();
    sides.set(s.balance.side, (sides.get(s.balance.side) ?? 0) + (articlesBySource.get(s.id) ?? 0));
    groups.set(s.balance.group, sides);
  }
  const held: Held[] = [];
  for (const [group, sides] of groups) {
    const missing = [...sides].filter(([, n]) => n === 0).map(([side]) => side).sort();
    if (missing.length) held.push({ group, missing });
  }
  const names = new Set(held.map((h) => h.group));
  const heldSources = new Set(sources.filter((s) => s.balance && names.has(s.balance.group)).map((s) => s.id));
  return { held: held.sort((a, b) => a.group.localeCompare(b.group)), heldSources };
}
