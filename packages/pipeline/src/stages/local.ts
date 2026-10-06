// Local stories from the towns no outlet reached (decisions 54, 67 and 78). GDELT reads news sites worldwide in 65
// languages and publishes, every 15 minutes, each article's URL, title and the places it names. This stage takes
// the newest few articles about every town GDELT tags that day, never in a town an outlet's story already sits in.
// The place comes from GDELT's city tag, checked against the city list and GeoNames' places of 500 people or more.
// No model reads these stories: they cost nothing, never join an event and sit at the lowest zoom tier.
import { Unzip, UnzipInflate } from "fflate";
import { eq } from "drizzle-orm";
import { ingestWindow, placeIdFor, type LocalStory, type RunDate } from "@2dayai/core";
import { loadMapView, localStories, type Db } from "@2dayai/db";
import { Gazetteer, km, NEAR_KM, type Located } from "../places.js";
import { noControl } from "../text.js";
import { HttpError, USER_AGENT } from "./ingest.js";

const BASE = "http://data.gdeltproject.org/gdeltv2/";
/** Files fetched at once. Each is tens of megabytes unzipped, read as a stream so memory stays small. */
const CONCURRENCY = 2;
const TITLE_MIN = 20;
const TITLE_MAX = 300;

/** Null when GDELT has no file for that quarter hour, which happens now and then. */
export type GdeltFetcher = (url: string) => Promise<Uint8Array | null>;

export const defaultGdeltFetcher: GdeltFetcher = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(90_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(`${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
};

/** How many local stories a day takes (decision 78). */
export type LocalLimits = {
  /** The newest stories of each town (GDELT_PER_TOWN). 0 turns the stage off. */
  perTown: number;
  /** In all (GDELT_MAX): a safety valve set well above a normal day, so a runaway day can't flood the map. */
  max: number;
};

/**
 * A GDELT town this close to a place with an outlet's story is that place, and gets no local stories (decision 78).
 * A few kilometres: the same town, whatever point either list gives it, but not the next municipality.
 */
export const OUTLET_KM = 3;

export type LocalReport = {
  files: number;
  filesMissing: number;
  filesFailed: number;
  /** Articles with a title and a town placed away from the outlets' places. */
  articles: number;
  /** Towns GDELT's articles were placed at that day, and how many of them sat at an outlet story's place. */
  townsTagged: number;
  townsNearOutlet: number;
  /** Regions on the city list with no outlet story that day, and how many of them got local stories. */
  regionsEmpty: number;
  regionsFilled: number;
  /** Regions with an outlet story that got local stories from other towns. */
  regionsAdded: number;
  /** Towns with a local story. */
  towns: number;
  stories: number;
  /** Stories left out by the day's limit, after every town had its first. */
  overMax: number;
  /**
   * GDELT towns of a country left out because no list names them and no listed city or town of that country lies
   * within NEAR_KM of GDELT's point, the stories in the window at them, and how many of those towns have one within
   * 50 km: what the 20 km rule costs, and what a looser one would add.
   */
  townsFar: number;
  articlesFar: number;
  townsFarWithin50: number;
  skipped?: string;
};

/** Every quarter-hour file of a window (a run date's, or the last 24 hours): the English stream and the translated one. */
export function gdeltFileUrls(window: { from: Date; to: Date }): string[] {
  const { from, to } = window;
  const out: string[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += 15 * 60 * 1000) {
    const stamp = new Date(t).toISOString().replace(/[-:T]/g, "").slice(0, 14);
    out.push(`${BASE}${stamp}.gkg.csv.zip`, `${BASE}${stamp}.translation.gkg.csv.zip`);
  }
  return out;
}

/** GDELT names languages with ISO 639-2 codes; the map uses ISO 639-1. */
const LANG: Record<string, string> = {
  afr: "af", alb: "sq", sqi: "sq", amh: "am", ara: "ar", arm: "hy", hye: "hy", aze: "az", bel: "be", ben: "bn", bos: "bs",
  bul: "bg", bur: "my", mya: "my", cat: "ca", chi: "zh", zho: "zh", hrv: "hr", cze: "cs", ces: "cs", dan: "da", dut: "nl",
  nld: "nl", eng: "en", est: "et", fin: "fi", fre: "fr", fra: "fr", geo: "ka", kat: "ka", ger: "de", deu: "de", gre: "el",
  ell: "el", guj: "gu", hau: "ha", heb: "he", hin: "hi", hun: "hu", ibo: "ig", ice: "is", isl: "is", ind: "id", ita: "it",
  jpn: "ja", kan: "kn", kaz: "kk", khm: "km", kor: "ko", kur: "ku", lao: "lo", lav: "lv", lit: "lt", mac: "mk", mkd: "mk",
  may: "ms", msa: "ms", mal: "ml", mar: "mr", mon: "mn", nep: "ne", nor: "no", per: "fa", fas: "fa", pol: "pl", por: "pt",
  pan: "pa", pus: "ps", rum: "ro", ron: "ro", rus: "ru", srp: "sr", sin: "si", slo: "sk", slk: "sk", slv: "sl", som: "so",
  spa: "es", swa: "sw", swe: "sv", tam: "ta", tel: "te", tgl: "tl", tha: "th", tur: "tr", ukr: "uk", urd: "ur", uzb: "uz",
  vie: "vi", xho: "xh", yor: "yo", zul: "zu",
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export type GkgArticle = { url: string; domain: string; title: string; lang: string | null; publishedAt: Date; town: { name: string; lat: number; lon: number } };

/** How long before the window a link's own date may be: a feed dated in another time zone, or a story GDELT read late. */
const URL_DATE_GRACE_MS = 3 * 86_400_000;

/**
 * The date a link carries in its path, when it has one: "/2021/06/08/", "/2021-06-08-", "/20210608/" at the end of a
 * segment or, for a month alone, "/2021/06/" (read as the month's last day). GDELT dates an article by when it read it, and now and then it
 * reads an old page again: a 2021 story about jets on the map of October 5, 2026. The separators must match, so a
 * day written first ("05-10-2026") is never read as a year.
 */
export function urlDate(url: string): Date | null {
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  const day =
    /(?<![0-9A-Za-z])(20\d\d)([/_-])(0[1-9]|1[0-2])\2(0[1-9]|[12]\d|3[01])(?!\d)/.exec(path) ??
    // Run together, only as the end of a path segment: a wire's id like "newsml-dpa-com-20090101-261005" is no date.
    /(?<=[/-])(20\d\d)()(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?=[/?#]|$)/.exec(path);
  if (day) return new Date(Date.UTC(+day[1]!, +day[3]! - 1, +day[4]!));
  const month = /\/(20\d\d)\/(0[1-9]|1[0-2])\//.exec(path);
  if (month) return new Date(Date.UTC(+month[1]!, +month[2]!, 0));
  return null;
}

/** Whether a link's own date is days before the window, so the story is old whatever GDELT says (decision 142). */
export function datedBefore(url: string, from: Date): boolean {
  const d = urlDate(url);
  return d !== null && d.getTime() < from.getTime() - URL_DATE_GRACE_MS;
}

/**
 * One row of a GDELT 2.1 GKG file (27 tab-separated columns), or null when it is not a web article with a title
 * and a town. The town is the city-level place the article names most, the earliest named on a tie. A country or
 * a state alone is never used: the map never places a story at an area (decision 44).
 */
export function parseGkgRow(line: string, translated: boolean): GkgArticle | null {
  const c = line.split("\t");
  if (c.length < 27 || c[2] !== "1") return null;
  const url = c[4]!;
  if (!/^https?:\/\//.test(url)) return null;
  const d = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(c[1]!);
  if (!d) return null;
  const publishedAt = new Date(Date.UTC(+d[1]!, +d[2]! - 1, +d[3]!, +d[4]!, +d[5]!, +d[6]!));
  const rawTitle = /<PAGE_TITLE>([\s\S]*?)<\/PAGE_TITLE>/.exec(c[26]!)?.[1];
  const title = rawTitle ? noControl(decodeEntities(rawTitle)).replace(/\s+/g, " ").trim() : "";
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) return null;

  // V2ENHANCEDLOCATIONS: Type#FullName#CountryCode#ADM1#ADM2#Lat#Long#FeatureID#CharOffset. Types 3 and 4 are
  // cities (United States and elsewhere); 1 is a country, 2 and 5 a state or province.
  // The story's country comes first: the one its places name most, counting every mention of the country, its
  // regions and its cities, the earliest named on a tie. Then that country's most-named city. A Syrian story that
  // cites "the London-based Syrian Observatory" names Syria and its towns more than London, so it sits in Syria,
  // not London; one that names no Syrian city is left out rather than placed in another country (decision 93).
  const countries = new Map<string, { count: number; first: number }>();
  const towns = new Map<string, { name: string; lat: number; lon: number; cc: string; count: number; first: number }>();
  for (const block of c[10]!.split(";")) {
    const f = block.split("#");
    const offset = Number(f[8]) || 0;
    const cc = f[2] ?? "";
    if (cc && ["1", "2", "3", "4", "5"].includes(f[0]!)) {
      const k = countries.get(cc);
      if (k) {
        k.count += 1;
        k.first = Math.min(k.first, offset);
      } else countries.set(cc, { count: 1, first: offset });
    }
    if (f[0] !== "3" && f[0] !== "4") continue;
    const lat = Number(f[5]);
    const lon = Number(f[6]);
    const name = (f[1] ?? "").split(",")[0]!.trim();
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    const key = f[7] || `${lat},${lon}`;
    const t = towns.get(key);
    if (t) {
      t.count += 1;
      t.first = Math.min(t.first, offset);
    } else towns.set(key, { name, lat, lon, cc, count: 1, first: offset });
  }
  const country = [...countries].sort(([, a], [, b]) => b.count - a.count || a.first - b.first)[0]?.[0] ?? "";
  const town = [...towns.values()].filter((t) => t.cc === country).sort((a, b) => b.count - a.count || a.first - b.first)[0];
  if (!town) return null;
  const code = translated ? /srclc:([a-z]{3})/.exec(c[25] ?? "")?.[1] : "eng";
  return { url, domain: c[3] || new URL(url).hostname, title, lang: code ? (LANG[code] ?? null) : null, publishedAt, town: { name: town.name, lat: town.lat, lon: town.lon } };
}

/**
 * A copy of a string that owns its characters. A substring of a line can keep the whole chunk of the file it came
 * from alive, so anything kept past the line is copied.
 */
const own = (s: string): string => Buffer.from(s, "utf8").toString("utf8");

/** A 53-bit fingerprint of a URL, so skipping repeats doesn't hold on to every URL of the day. */
function fingerprint(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Bytes handed to the unzipper at a time. Given a whole file at once, it returns the whole file as one chunk. */
const SLICE = 16 * 1024;

/**
 * Every line of every file in a GDELT zip, unzipped and decoded a chunk at a time. Unzipping a whole day's files
 * into strings ran the daily job out of memory, and so did one giant chunk per file: any string kept from it kept
 * the whole file alive. Returns how many chunks it decoded.
 */
export function forEachLine(bytes: Uint8Array, onLine: (line: string) => void): number {
  let chunks = 0;
  const unzip = new Unzip((file) => {
    const decoder = new TextDecoder();
    let rest = "";
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      chunks += 1;
      const lines = (rest + decoder.decode(chunk, { stream: !final })).split("\n");
      rest = final ? "" : lines.pop()!;
      for (const line of lines) if (line) onLine(line);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let i = 0; i < bytes.length; i += SLICE) unzip.push(bytes.subarray(i, i + SLICE), i + SLICE >= bytes.length);
  if (bytes.length === 0) unzip.push(bytes, true);
  return chunks;
}

/** One article kept as a candidate. Only copied strings go in here (see own); nothing that points back into a file. */
export type LocalCandidate = { url: string; domain: string; title: string; lang: string | null; publishedAt: Date; at: Located };
/** One town's candidates, newest first, and its region, which only says whether an outlet reached it. */
export type TownCandidates = { region: string; reached: boolean; stories: LocalCandidate[] };
export type LocalPick = LocalCandidate & { region: string; town: string; reached: boolean };

/**
 * The day's local stories from every town's candidates (decision 78): the newest `perTown` of each town, and, over
 * the day's `max`, every town's newest before any town's second. Within a round, towns in a region no outlet reached
 * come first, then the newest. Nothing but time and place decides.
 */
export function pickLocal(towns: Map<string, TownCandidates>, limits: LocalLimits): { picked: LocalPick[]; overMax: number } {
  const ranked: (LocalPick & { rank: number })[] = [];
  for (const [town, { region, reached, stories }] of towns) stories.slice(0, limits.perTown).forEach((c, rank) => ranked.push({ ...c, region, town, reached, rank }));
  ranked.sort((a, b) => a.rank - b.rank || Number(a.reached) - Number(b.reached) || b.publishedAt.getTime() - a.publishedAt.getTime() || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  const picked = ranked.slice(0, limits.max).map(({ rank: _, ...p }) => p);
  return { picked, overMax: ranked.length - picked.length };
}

/** Whether a point lies within OUTLET_KM of any of the given places, by a grid of half-degree cells. */
function nearAny(points: { lat: number; lon: number }[]): (lat: number, lon: number) => boolean {
  const cell = (v: number) => Math.floor(v * 2);
  const grid = new Map<string, { lat: number; lon: number }[]>();
  for (const p of points) {
    const k = `${cell(p.lat)},${cell(p.lon)}`;
    grid.set(k, [...(grid.get(k) ?? []), p]);
  }
  return (lat, lon) => {
    const cols = Math.min(360, Math.ceil(OUTLET_KM / (55 * Math.max(Math.cos((Math.min(89, Math.abs(lat)) * Math.PI) / 180), 0.02))));
    for (let y = cell(lat) - 1; y <= cell(lat) + 1; y++)
      for (let x = cell(lon) - cols; x <= cell(lon) + cols; x++)
        for (const p of grid.get(`${y},${((((x + 360) % 720) + 720) % 720) - 360}`) ?? []) if (km(lat, lon, p.lat, p.lon) <= OUTLET_KM) return true;
    return false;
  };
}

/**
 * The run date's local stories, from its ingest window, or from `window` instead: the refresh during the day reads
 * the last 24 hours and replaces the day's local stories with them (decision 80).
 */
export async function runLocal(
  db: Db,
  date: RunDate,
  limits: LocalLimits,
  fetchGdelt: GdeltFetcher = defaultGdeltFetcher,
  gaz = Gazetteer.loadWithTowns(),
  window: { from: Date; to: Date } = ingestWindow(date),
  /** Given, it receives the stories stored, so a refresh can publish them without reading them back (decision 124). */
  keep?: { stories?: LocalStory[] },
): Promise<LocalReport> {
  const empty = { files: 0, filesMissing: 0, filesFailed: 0, articles: 0, townsTagged: 0, townsNearOutlet: 0, regionsEmpty: 0, regionsFilled: 0, regionsAdded: 0, towns: 0, stories: 0, overMax: 0, townsFar: 0, articlesFar: 0, townsFarWithin50: 0 };
  if (limits.perTown === 0) {
    await db.delete(localStories).where(eq(localStories.runDate, date));
    return { ...empty, skipped: "GDELT_PER_TOWN is 0" };
  }

  // A region counts as reached when any outlet's story on the day's map sits in it, the way the coverage count sees
  // it. A country the list gives no regions counts as one. The day's local stories stay in the database (the index
  // only), so the old ones never count as outlets' places.
  const map = await loadMapView(db, date, undefined, { local: "index", noCarry: true });
  const outletPlaces = [...new Set(map.items.map((i) => i.place))].flatMap((p) => (map.places[p] ? [map.places[p]] : []));
  const regionOf = (lat: number, lon: number): string | null => {
    const area = gaz.areaAt(lat, lon);
    return area ? (area.region ?? `${area.country}/`) : null;
  };
  const reached = new Set(outletPlaces.flatMap((p) => regionOf(p.lat, p.lon) ?? []));
  const nearOutlet = nearAny(outletPlaces);
  const regionsEmpty = gaz.regions().filter((r) => !reached.has(r)).length;

  // Where each GDELT town goes, worked out once per town: most of a day's articles name a town seen before.
  type Spot = { region: string; town: string; at: Located } | null;
  const spots = new Map<string, Spot>();
  /** Towns turned away by the 20 km rule (keys as in `spots`), and how many of them have a listed place within 50 km. */
  const far = new Set<string>();
  let farWithin50 = 0;
  let articlesFar = 0;
  const tagged = new Set<string>();
  const nearOutlets = new Set<string>();
  const spotOf = (t: GkgArticle["town"]): Spot => {
    const key = `${t.name}|${t.lat}|${t.lon}`;
    let spot = spots.get(key);
    if (spot !== undefined) return spot;
    spot = null;
    const area = gaz.areaAt(t.lat, t.lon);
    const at = area ? gaz.locate({ city: t.name, country: area.country, lat: t.lat, lon: t.lon }, true) : null;
    if (area && !at && !gaz.hasPlaceNear(t.lat, t.lon, NEAR_KM, area.country)) {
      far.add(key);
      if (gaz.hasPlaceNear(t.lat, t.lon, 50, area.country)) farWithin50 += 1;
    }
    const town = at ? placeIdFor(at.lat, at.lon) : "";
    if (at) tagged.add(town);
    // A town an outlet's story already sits in keeps its outlets' stories alone.
    const outlet = at ? nearOutlet(at.lat, at.lon) : false;
    if (outlet) nearOutlets.add(town);
    const region = at && !outlet ? regionOf(at.lat, at.lon) : null;
    if (at && region) spot = { region: own(region), town, at: { name: own(at.name), lat: at.lat, lon: at.lon } };
    spots.set(own(key), spot);
    return spot;
  };

  const { from, to } = window;
  const towns = new Map<string, TownCandidates>();
  /** Headlines already taken in each region, so a story syndicated across its towns counts once. */
  const titles = new Map<string, Map<string, number>>();
  const seen = new Set<number>();
  let articles = 0;
  const take = (a: GkgArticle) => {
    const print = fingerprint(a.url);
    if (seen.has(print) || a.publishedAt < from || a.publishedAt >= to || datedBefore(a.url, from)) return;
    seen.add(print);
    const spot = spotOf(a.town);
    if (!spot) {
      if (far.has(`${a.town.name}|${a.town.lat}|${a.town.lon}`)) articlesFar += 1;
      return;
    }
    articles += 1;
    let seenTitles = titles.get(spot.region);
    if (!seenTitles) titles.set(spot.region, (seenTitles = new Map()));
    // The same headline twice in a region is one story, whichever site ran it.
    const title = a.title.toLowerCase();
    if (seenTitles.has(title)) return;
    let town = towns.get(spot.town);
    if (!town) towns.set(spot.town, (town = { region: spot.region, reached: reached.has(spot.region), stories: [] }));
    const list = town.stories;
    // A town full of newer stories has no room for an older one.
    if (list.length >= limits.perTown && list[list.length - 1]!.publishedAt >= a.publishedAt) return;
    const c: LocalCandidate = { url: own(a.url), domain: own(a.domain), title: own(a.title), lang: a.lang, publishedAt: a.publishedAt, at: spot.at };
    // Newest first, as every list on the site is. A town never needs more than its limit.
    const i = list.findIndex((x) => x.publishedAt < c.publishedAt);
    list.splice(i < 0 ? list.length : i, 0, c);
    seenTitles.set(own(title), (seenTitles.get(title) ?? 0) + 1);
    if (list.length > limits.perTown) {
      const dropped = list.pop()!.title.toLowerCase();
      const n = (seenTitles.get(dropped) ?? 1) - 1;
      if (n > 0) seenTitles.set(dropped, n);
      else seenTitles.delete(dropped);
    }
  };

  const urls = gdeltFileUrls(window);
  let filesMissing = 0;
  let filesFailed = 0;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < urls.length) {
      const url = urls[next++]!;
      let bytes: Uint8Array | null;
      try {
        bytes = await fetchGdelt(url);
      } catch (err) {
        filesFailed += 1;
        console.error(`local: ${url} ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      if (!bytes) {
        filesMissing += 1;
        continue;
      }
      const translated = url.includes(".translation.");
      try {
        forEachLine(bytes, (line) => {
          const a = parseGkgRow(line, translated);
          if (a) take(a);
        });
      } catch (err) {
        filesFailed += 1;
        console.error(`local: ${url} could not be read. ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // GDELT unreachable is an outage, not a quiet day: say so instead of writing nothing. GDELT publishes every quarter
  // hour, so a window with no file at all is an outage too. Either way the day keeps the local stories it had.
  if (urls.length > 0 && filesFailed + filesMissing === urls.length) throw new Error(`local: none of the ${urls.length} GDELT files could be read`);

  const { picked, overMax } = pickLocal(towns, limits);
  const rows = picked.map((a) => ({ runDate: date, url: a.url, title: a.title, domain: a.domain.replace(/^www\./, ""), lang: a.lang, publishedAt: a.publishedAt, placeName: a.at.name, lat: a.at.lat, lon: a.at.lon, region: a.region }));
  // Re-running the day, or the refresh, replaces its local stories, only once the new ones are in hand, and in one
  // transaction, so a failure part way leaves the old ones. A thousand rows a statement: tens of thousands of stories
  // go to the database in a few dozen round trips.
  await db.transaction(async (tx) => {
    await tx.delete(localStories).where(eq(localStories.runDate, date));
    for (let i = 0; i < rows.length; i += 1000) await tx.insert(localStories).values(rows.slice(i, i + 1000)).onConflictDoNothing();
  });
  if (keep) keep.stories = rows;
  const filled = new Set(picked.map((p) => p.region));
  return {
    files: urls.length,
    filesMissing,
    filesFailed,
    articles,
    townsTagged: tagged.size,
    townsNearOutlet: nearOutlets.size,
    regionsEmpty,
    regionsFilled: [...filled].filter((r) => !reached.has(r)).length,
    regionsAdded: [...filled].filter((r) => reached.has(r)).length,
    towns: new Set(picked.map((p) => p.town)).size,
    stories: rows.length,
    overMax,
    townsFar: far.size,
    articlesFar,
    townsFarWithin50: farWithin50,
  };
}
