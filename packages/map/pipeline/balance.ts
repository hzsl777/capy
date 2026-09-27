import type { PoolItem } from "./pool.ts";

export interface BalanceOptions {
  /** Most items kept for one place. */
  perPlace: number;
  /** Most items one outlet may contribute to one place. */
  perDomainPerPlace: number;
  /** Most items one outlet may contribute across the whole map. Keeps wire services from flooding it. */
  perDomainGlobal: number;
}

export const DEFAULT_BALANCE: BalanceOptions = {
  perPlace: 24,
  perDomainPerPlace: 3,
  perDomainGlobal: 120,
};

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Chooses what the map shows. Order is newest first and nothing else:
 * no popularity, tone or "importance" signal is used, by design.
 * Within a place, outlets take turns so one outlet can't fill a city's list.
 */
export function balance(items: PoolItem[], opts: BalanceOptions = DEFAULT_BALANCE): PoolItem[] {
  const newestFirst = [...items].sort((a, b) => b.t - a.t);

  const seenUrl = new Set<string>();
  const byPlace = new Map<string, PoolItem[]>();
  for (const it of newestFirst) {
    if (seenUrl.has(it.url)) continue;
    seenUrl.add(it.url);
    const list = byPlace.get(it.place.id) ?? [];
    list.push(it);
    byPlace.set(it.place.id, list);
  }

  const picked: PoolItem[] = [];
  for (const list of byPlace.values()) {
    const byDomain = new Map<string, PoolItem[]>();
    for (const it of list) {
      const d = byDomain.get(it.domain) ?? [];
      d.push(it);
      byDomain.set(it.domain, d);
    }
    const titles = new Set<string>();
    const queues = [...byDomain.values()].map((q) => q.slice(0, opts.perDomainPerPlace));
    const out: PoolItem[] = [];
    // Round-robin across outlets, each queue already newest first.
    for (let round = 0; out.length < opts.perPlace; round++) {
      let any = false;
      for (const q of queues) {
        const it = q[round];
        if (!it) continue;
        any = true;
        const key = norm(it.title);
        if (titles.has(key)) continue;
        titles.add(key);
        out.push(it);
        if (out.length >= opts.perPlace) break;
      }
      if (!any) break;
    }
    picked.push(...out);
  }

  const perDomain = new Map<string, number>();
  return picked
    .sort((a, b) => b.t - a.t)
    .filter((it) => {
      const n = (perDomain.get(it.domain) ?? 0) + 1;
      perDomain.set(it.domain, n);
      return n <= opts.perDomainGlobal;
    });
}
