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
export async function loadNews(base = import.meta.env.BASE_URL, wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<MapFile> {
  let noDayYet = false;
  // The day's file is tried three times, a second and then three apart, before the page says it couldn't load: a
  // network blip or a deploy in progress shouldn't leave a reader with no news (decision 125).
  for (const [attempt, pause] of [0, 1000, 3000].entries()) {
    if (pause) await wait(pause);
    for (const name of ["latest.json", "sample.json"]) {
      try {
        const res = await fetch(`${base}data/${name}`, { cache: "no-cache" });
        // The Worker answers 404 until the first daily run has written a day.
        if (res.status === 404 && name === "latest.json") noDayYet = true;
        if (!res.ok) continue;
        const file = (await res.json()) as MapFile;
        if (file.version === 2 && Array.isArray(file.items)) {
          for (const it of file.items) {
            it.title = withoutEmoji(it.title);
            if (it.excerpt) it.excerpt = withoutEmoji(it.excerpt);
          }
          return file;
        }
      } catch {
        /* try the next file */
      }
    }
    if (noDayYet || attempt === 2) break;
  }
  throw new Error(noDayYet ? NO_DAY_YET : "No news data found");
}

export function passes(item: MapItem, f: Filters): boolean {
  if (item.t < f.from || item.t > f.to) return false;
  if (f.topics.size === FILTERS.length) return true;
  if (item.topics.length === 0) return f.topics.has("other");
  return item.topics.some((t) => f.topics.has(t));
}

/** Replay's step between moments, in milliseconds, at 33: the pace it has in every design (Record Player's 45 is quicker). */
export const REPLAY_MS = 220;

/**
 * The time bar's stops Replay plays, in order: the slots from `first` to `slots` whose window (`windowSec` ending at the
 * slot's time) holds at least one of `times` (sorted, unix seconds). The outlets' stories come in once a day while the
 * map's clock moves on with GDELT's (decision 80), so stretches with nothing on the map at the reader's zoom are skipped.
 */
export function replayStops(times: readonly number[], end: number, first: number, slots: number, windowSec: number, slotSec = 900): number[] {
  const out: number[] = [];
  for (let s = first; s <= slots; s++) {
    const to = end - (slots - s) * slotSec;
    const from = to - windowSec;
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < from) lo = mid + 1;
      else hi = mid;
    }
    if (lo < times.length && times[lo] <= to) out.push(s);
  }
  return out;
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
  // A report on another country, shown at its outlet's city, never brings that city in sooner (decision 107).
  if (item.abroad) return 3;
  const reach = item.reach ?? 1;
  const importance = item.importance ?? 1;
  if (item.importance === undefined && item.reach === undefined) return 4;
  if (importance >= 4 || reach >= 4) return 0;
  if (importance >= 3 || reach >= 3) return 1;
  if (importance >= 2 || reach >= 2) return 2;
  return 3;
}

/**
 * A place's weight for its mark: its most important story, 1 to 5 (decisions 46 and 146). Reports on another country
 * count as 1. GDELT's local stories carry importance 1 but no model rated them, so a place with only those is 0, which
 * the map draws as a dashed outline, "not rated".
 */
export function weightOf(items: MapItem[]): number {
  return Math.max(0, ...items.map((it) => (it.via === "gdelt" ? 0 : it.abroad ? 1 : (it.importance ?? 1))));
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

/**
 * A scale bar (Pin Drop): the longest round distance, 1, 2 or 5 times a power of ten, that fits in `px` screen
 * pixels at `kmPerPx`, and its length in pixels.
 */
export function scaleBar(kmPerPx: number, px: number): { km: number; width: number } {
  const most = kmPerPx * px;
  const p = 10 ** Math.floor(Math.log10(most));
  const km = [5, 2, 1].map((m) => m * p).find((v) => v <= most) ?? p;
  return { km, width: km / kmPerPx };
}

export function formatRunDate(runDate: string): string {
  const d = new Date(`${runDate}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

/** A run date in short, "Sep 29" in English, for the list of earlier words (decision 112). */
export function formatShortDate(runDate: string): string {
  const d = new Date(`${runDate}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** A run date's weekday, "Saturday", for "Saturday's news". */
export function formatWeekday(runDate: string): string {
  return new Date(`${runDate}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" });
}

/**
 * The date a word is shown under: the day after the day it covers, as a morning paper is dated (decision 127). The
 * daily run builds a day just after it ends at midnight in New York, so the word on show carries today's date there.
 * The strip says only that it weighed a full day of news (decision 142); the word's own view names that day.
 */
export function editionDate(runDate: string): string {
  return new Date(Date.parse(`${runDate}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** The time zone the day ends in (decision 127), as in core's dates.ts. */
export const DAY_ZONE = "America/New_York";
const zoneDay = new Intl.DateTimeFormat("en-CA", { timeZone: DAY_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The last day that has ended in New York: the one the daily run builds next, or has just built. */
export function lastFullDay(now: Date = new Date()): string {
  return new Date(Date.parse(`${zoneDay.format(now)}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * What the word strip says about the word (decisions 81 and 127). A word belongs to a finished day and is shown until
 * the next one is chosen. `note` says when the next is on its way (the day that just ended has no map yet) or when the
 * map's own day had no word and an earlier one is shown. Never for the sample or a demo.
 */
export function wordStatus(file: Pick<MapFile, "runDate" | "source" | "telegram">, now: Date = new Date()): { date: string; note: string | null } {
  const date = file.telegram?.runDate ?? file.runDate;
  if (file.source !== "live") return { date, note: null };
  const last = lastFullDay(now);
  if (file.runDate < last) return { date, note: `The next word, from ${formatWeekday(last)}'s news, is being chosen.` };
  if (file.telegram && file.telegram.runDate !== file.runDate) return { date, note: `${formatWeekday(file.runDate)}'s news gave no word: none passed the checks.` };
  return { date, note: null };
}

/**
 * Headlines and summaries without emoji (decision 127). Some outlets put pictographs or flags beside a headline; a
 * flag would set a country's symbol beside a story, and the rest read as the site's own decoration. Only the
 * pictographs go, with the joiners and selectors that build them; the words, letters, digits and punctuation stay as
 * published, and the copyright and trademark signs are kept.
 */
const EMOJI = /(?![\u00a9\u00ae\u2122])\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u200d\ufe0e\ufe0f\u20e3]|[\u{1f3fb}-\u{1f3ff}]|[\u{e0020}-\u{e007f}]/gu;
export function withoutEmoji(text: string): string {
  if (!/[^\u0000-\u2000]/.test(text)) return text;
  return text.replace(EMOJI, "").replace(/\s{2,}/g, " ").trim();
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
  return tile.items.map(([id, t, title, url, domain, lang, place]) => ({ id, t, title: withoutEmoji(title), url, domain, publisher: domain, lang, topics: [], place: placeOf(place), reach: 1, importance: 1, via: "gdelt" }));
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

/**
 * Where to send a reader who opened the site at another of its addresses (decision 93): the www name or the Worker's
 * own workers.dev address go to the canonical one the build wrote (globalgist.io, or SITE_DOMAIN). A branch preview, local
 * development, or a build without a canonical address stays where it is.
 */
export function canonicalRedirect(here: URL, canonical: string | null): string | null {
  if (!canonical) return null;
  let home: URL;
  try {
    home = new URL(canonical);
  } catch {
    return null;
  }
  if (here.hostname === home.hostname) return null;
  const other = here.hostname === `www.${home.hostname}` || (here.hostname.startsWith("globalgist.") && here.hostname.endsWith(".workers.dev"));
  return other ? `${home.origin}${here.pathname}${here.search}` : null;
}

export type OriginGroup = { origin: "here" | "elsewhere" | "abroad" | "gdelt"; items: MapItem[] };

/**
 * A place's reports in the order a reader looks for them (decision 98): outlets that publish from the place first,
 * then outlets elsewhere that reported on it, then the place's outlets' reports on another country that name no city
 * to place them (decision 107), then the local stories found through GDELT. Where an outlet is based is
 * the only thing that orders them; within a group the order the items came in (newest first) is kept, and no outlet
 * is ranked above another. Empty groups are left out.
 */
export function byOrigin(items: readonly MapItem[]): OriginGroup[] {
  const groups: OriginGroup[] = [
    { origin: "here", items: [] },
    { origin: "elsewhere", items: [] },
    { origin: "abroad", items: [] },
    { origin: "gdelt", items: [] },
  ];
  for (const it of items) groups[it.via === "gdelt" ? 3 : it.abroad ? 2 : it.from ? 1 : 0]!.items.push(it);
  return groups.filter((g) => g.items.length);
}
