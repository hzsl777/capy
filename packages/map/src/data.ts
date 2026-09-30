import { TOPICS, type MapFile, type MapItem, type MapLocalIndex, type MapTile, type Topic } from "./types.ts";

export type TopicFilter = Topic;
export const FILTERS: TopicFilter[] = [...TOPICS];

export interface Filters {
  topics: Set<TopicFilter>;
  /** Unix seconds, inclusive. */
  from: number;
  to: number;
}

export const NO_DAY_YET = "no day yet";

/** Live data from the Worker (data/latest.json), else the placeholder sample made by `npm run map:sample`. */
export async function loadNews(base = import.meta.env.BASE_URL): Promise<MapFile> {
  let noDayYet = false;
  for (const name of ["latest.json", "sample.json"]) {
    try {
      const res = await fetch(`${base}data/${name}`, { cache: "no-cache" });
      // The Worker answers 404 until the first daily run has written a day.
      if (res.status === 404 && name === "latest.json") noDayYet = true;
      if (!res.ok) continue;
      const file = (await res.json()) as MapFile;
      if (file.version === 2 && Array.isArray(file.items)) return file;
    } catch {
      /* try the next file */
    }
  }
  throw new Error(noDayYet ? NO_DAY_YET : "No news data found");
}

export function passes(item: MapItem, f: Filters): boolean {
  if (item.t < f.from || item.t > f.to) return false;
  if (f.topics.size === FILTERS.length) return true;
  if (item.topics.length === 0) return f.topics.has("other");
  return item.topics.some((t) => f.topics.has(t));
}

/** Items per place index that pass the filters, newest first. */
/** Zoom tiers: the whole world shows tier 0, and each step in adds the next (decisions 30 and 46). */
export const TIERS = 5;

/**
 * The zoom level from which an article's place shows (decisions 30 and 46), ranked by the grouping model's
 * importance and by how many outlet cities reported the story:
 *   0: importance 4 or 5, or reported from four or more cities
 *   1: importance 3, or three cities
 *   2: importance 2, or two cities
 *   3: importance 1
 *   4: anything not grouped: GDELT local stories, which no model rates (decisions 54 and 67), and days grouped
 *      before decision 50. There can be several thousand, so they wait for the closest zoom.
 * A file without event data (a demo, or a day before grouping ran) shows everything from the start.
 */
export function tierOf(item: MapItem, tiered: boolean): number {
  if (!tiered) return 0;
  if (item.via === "gdelt") return TIERS - 1;
  const reach = item.reach ?? 1;
  const importance = item.importance ?? 1;
  if (item.importance === undefined && item.reach === undefined) return 4;
  if (importance >= 4 || reach >= 4) return 0;
  if (importance >= 3 || reach >= 3) return 1;
  if (importance >= 2 || reach >= 2) return 2;
  return 3;
}

/** A place's weight for dot size: its most important story, 1 to 5 (decision 46). */
export function weightOf(items: MapItem[]): number {
  return Math.max(1, ...items.map((it) => it.importance ?? 1));
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

/**
 * What the word strip says about the word (decision 81). A word belongs to a finished UTC day and is shown under that
 * day's date until the next one is chosen. `note` says when the next is on its way (the day that just ended has no
 * map yet) or when the map's own day had no word and an earlier one is shown. Never for the sample or a demo.
 */
export function wordStatus(file: Pick<MapFile, "runDate" | "source" | "telegram">, now: Date = new Date()): { date: string; note: string | null } {
  const date = file.telegram?.runDate ?? file.runDate;
  if (file.source !== "live") return { date, note: null };
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  if (file.runDate < yesterday) return { date, note: `The word for ${formatRunDate(yesterday)} is being chosen.` };
  if (file.telegram && file.telegram.runDate !== file.runDate) return { date, note: `${formatRunDate(file.runDate)} has no word: none passed the checks.` };
  return { date, note: null };
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

// ---- tiles of local stories (decision 78) -------------------------------------

/**
 * The key of the tile holding a point, as tileKey in core names it ("40N_80W"). Repeated here as a value so the site
 * stays free of core's code; test/tiles.test.ts checks the two agree.
 */
export function tileKeyOf(lat: number, lon: number, deg: number): string {
  const south = Math.max(-90, Math.min(90 - deg, Math.floor(lat / deg) * deg));
  const west = Math.max(-180, Math.min(180 - deg, Math.floor(lon / deg) * deg));
  return `${Math.abs(south)}${south < 0 ? "S" : "N"}_${Math.abs(west)}${west < 0 ? "W" : "E"}`;
}

/** A tile key's cell in degrees, or null for a key that isn't one. */
export function tileCell(key: string, deg: number): { south: number; west: number; north: number; east: number } | null {
  const m = /^(\d{1,2})([NS])_(\d{1,3})([EW])$/.exec(key);
  if (!m) return null;
  const south = Number(m[1]) * (m[2] === "S" ? -1 : 1);
  const west = Number(m[3]) * (m[4] === "W" ? -1 : 1);
  return { south, west, north: south + deg, east: west + deg };
}

/** Where a tile is, next to the day's file; null when the file's index names a folder the site never uses. */
export function tileUrl(dataBase: string, index: MapLocalIndex, key: string): string | null {
  if (!/^local\/[\w-]+\/$/.test(index.base) || !tileCell(key, index.deg)) return null;
  return `${dataBase}data/${index.base}${key}.json`;
}

/** A tile's rows as the site's stories: every one a GDELT local story, the lowest rank, no topic. */
export function tileItems(tile: MapTile, placeOf: (i: number) => number): MapItem[] {
  return tile.items.map(([id, t, title, url, domain, lang, place]) => ({ id, t, title, url, domain, publisher: domain, lang, topics: [], place: placeOf(place), reach: 1, importance: 1, via: "gdelt" }));
}

/**
 * Adds loaded tiles to the day: places the file already has (by id) are the same places, new ones are appended so
 * every index the page holds stays valid, and the stories join the day's list. Returns how many stories were added.
 */
export function mergeTiles(file: MapFile, placeIds: Map<string, number>, tiles: MapTile[]): number {
  let added = 0;
  const known = new Set(file.items.map((i) => i.id));
  for (const tile of tiles) {
    if (tile.version !== 2 || !Array.isArray(tile.places) || !Array.isArray(tile.items)) continue;
    const at = tile.places.map((p) => {
      let i = placeIds.get(p.id);
      if (i === undefined) placeIds.set(p.id, (i = file.places.push({ id: p.id, name: p.name, lat: p.lat, lon: p.lon }) - 1));
      return i;
    });
    for (const it of tileItems(tile, (i) => at[i]!)) {
      if (known.has(it.id) || it.place === undefined) continue;
      known.add(it.id);
      file.items.push(it);
      added += 1;
    }
  }
  return added;
}
