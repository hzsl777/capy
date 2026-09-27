import type { PoolItem } from "./pool.ts";

const WINDOW = 12 * 3600;

/**
 * Groups articles about the same story so the app can show "coverage elsewhere".
 * Two articles join when they name at least two of the same uncommon people or
 * organisations within 12 hours. GDELT extracts entities from translated text, so
 * this also links coverage across languages. Only groups spanning two or more
 * places get a story id; a group is never labelled or ranked.
 */
export function cluster(items: PoolItem[]): void {
  const df = new Map<string, number>();
  for (const it of items) for (const e of new Set(it.entities)) df.set(e, (df.get(e) ?? 0) + 1);
  const maxDf = Math.max(8, Math.floor(items.length * 0.01));
  const rare = (e: string) => {
    const n = df.get(e) ?? 0;
    return n >= 2 && n <= maxDf;
  };

  interface Group {
    entities: Set<string>;
    members: PoolItem[];
    lastT: number;
  }
  const groups: Group[] = [];
  const index = new Map<string, Set<number>>();

  for (const it of [...items].sort((a, b) => a.t - b.t)) {
    it.story = undefined;
    const ents = [...new Set(it.entities)].filter(rare);
    if (ents.length < 2) continue;
    const scores = new Map<number, number>();
    for (const e of ents) for (const g of index.get(e) ?? []) scores.set(g, (scores.get(g) ?? 0) + 1);
    let best = -1;
    let bestScore = 1;
    for (const [g, s] of scores) {
      if (s > bestScore && it.t - groups[g].lastT <= WINDOW) {
        best = g;
        bestScore = s;
      }
    }
    if (best === -1) {
      best = groups.push({ entities: new Set(), members: [], lastT: it.t }) - 1;
    }
    const g = groups[best];
    g.members.push(it);
    g.lastT = Math.max(g.lastT, it.t);
    for (const e of ents) {
      if (g.entities.size >= 40) break;
      if (g.entities.has(e)) continue;
      g.entities.add(e);
      const set = index.get(e) ?? new Set<number>();
      set.add(best);
      index.set(e, set);
    }
  }

  for (const g of groups) {
    const places = new Set(g.members.map((m) => m.place.id));
    if (places.size < 2) continue;
    const id = "s" + shortHash(g.members[0].id);
    for (const m of g.members) m.story = id;
  }
}

export function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
