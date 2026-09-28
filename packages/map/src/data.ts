import { TOPICS, type MapFile, type MapItem, type Topic } from "./types.ts";

export type TopicFilter = Topic;
export const FILTERS: TopicFilter[] = [...TOPICS];

export interface Filters {
  topics: Set<TopicFilter>;
  /** Unix seconds, inclusive. */
  from: number;
  to: number;
}

/** Live data from the Worker (data/latest.json), else the placeholder sample made by `npm run map:sample`. */
export async function loadNews(base = import.meta.env.BASE_URL): Promise<MapFile> {
  for (const name of ["latest.json", "sample.json"]) {
    try {
      const res = await fetch(`${base}data/${name}`, { cache: "no-cache" });
      if (!res.ok) continue;
      const file = (await res.json()) as MapFile;
      if (file.version === 2 && Array.isArray(file.items)) return file;
    } catch {
      /* try the next file */
    }
  }
  throw new Error("No news data found");
}

export function passes(item: MapItem, f: Filters): boolean {
  if (item.t < f.from || item.t > f.to) return false;
  if (f.topics.size === FILTERS.length) return true;
  if (item.topics.length === 0) return f.topics.has("other");
  return item.topics.some((t) => f.topics.has(t));
}

/** Items per place index that pass the filters, newest first. */
/**
 * The zoom level from which an article's place shows (decision 30): 0 when its story is reported in three or
 * more places or the model rated it 4 or 5, 1 for two places or importance 3, otherwise 2. A file without
 * event data (a demo, or a day before grouping ran) shows everything from the start.
 */
export function tierOf(item: MapItem, tiered: boolean): number {
  if (!tiered) return 0;
  const reach = item.reach ?? 1;
  const importance = item.importance ?? 1;
  if (reach >= 3 || importance >= 4) return 0;
  if (reach >= 2 || importance >= 3) return 1;
  return 2;
}

export function hasTiers(file: MapFile): boolean {
  return file.items.some((i) => i.reach !== undefined || i.importance !== undefined);
}

export function groupByPlace(file: MapFile, f: Filters): Map<number, MapItem[]> {
  const out = new Map<number, MapItem[]>();
  for (const it of file.items) {
    if (!passes(it, f)) continue;
    const list = out.get(it.place);
    if (list) list.push(it);
    else out.set(it.place, [it]);
  }
  for (const list of out.values()) list.sort((a, b) => b.t - a.t);
  return out;
}

export function storyIndex(file: MapFile): Map<string, MapItem[]> {
  const out = new Map<string, MapItem[]>();
  for (const it of file.items) {
    if (!it.story) continue;
    const list = out.get(it.story);
    if (list) list.push(it);
    else out.set(it.story, [it]);
  }
  return out;
}

export function timeAgo(t: number, now: number): string {
  const s = Math.max(0, now - t);
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
}

export function formatCoords(lat: number, lon: number): string {
  const f = (v: number, pos: string, neg: string) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = Math.round((a - d) * 60);
    return `${d}°${String(m).padStart(2, "0")}′ ${v >= 0 ? pos : neg}`;
  };
  return `${f(lat, "N", "S")}  ${f(lon, "E", "W")}`;
}

export function formatRunDate(runDate: string): string {
  const d = new Date(`${runDate}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

const langNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(undefined, { type: "language" }) : null;

export function languageName(code: string): string {
  if (!code || code === "und") return "";
  try {
    return langNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

export const TOPIC_LABEL: Record<TopicFilter, string> = {
  politics: "Politics",
  economy: "Economy",
  conflict: "Conflict & security",
  environment: "Environment",
  health: "Health",
  science: "Science & tech",
  justice: "Justice",
  culture: "Culture",
  sport: "Sport",
  other: "Other",
};
