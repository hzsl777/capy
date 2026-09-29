// Local stories for the regions no outlet reached (decision 54). GDELT reads news sites worldwide in 65 languages
// and publishes, every 15 minutes, each article's URL, title and the places it names. For every first-level region
// with no story on the day's map, this stage takes the newest few articles about a town there. The place comes from
// GDELT's city tag, checked against the city list the same way the grouping stage's places are (decision 44). No
// model reads these stories: they cost nothing, never join an event and sit at the lowest zoom tier.
import { Unzip, UnzipInflate } from "fflate";
import { eq } from "drizzle-orm";
import { ingestWindow, type RunDate } from "@2dayai/core";
import { loadMapView, localStories, type Db } from "@2dayai/db";
import { Gazetteer } from "../places.js";
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

export type LocalReport = {
  files: number;
  filesMissing: number;
  filesFailed: number;
  /** Articles with a title and a town GDELT placed. */
  articles: number;
  regionsEmpty: number;
  regionsFilled: number;
  stories: number;
  skipped?: string;
};

/** Every quarter-hour file of the run date's window: the English stream and the translated one. */
export function gdeltFileUrls(date: RunDate): string[] {
  const { from, to } = ingestWindow(date);
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
  // cities (United States and elsewhere).
  const towns = new Map<string, { name: string; lat: number; lon: number; count: number; first: number }>();
  for (const block of c[10]!.split(";")) {
    const f = block.split("#");
    if (f[0] !== "3" && f[0] !== "4") continue;
    const lat = Number(f[5]);
    const lon = Number(f[6]);
    const name = (f[1] ?? "").split(",")[0]!.trim();
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    const key = f[7] || `${lat},${lon}`;
    const offset = Number(f[8]) || 0;
    const t = towns.get(key);
    if (t) {
      t.count += 1;
      t.first = Math.min(t.first, offset);
    } else towns.set(key, { name, lat, lon, count: 1, first: offset });
  }
  const town = [...towns.values()].sort((a, b) => b.count - a.count || a.first - b.first)[0];
  if (!town) return null;
  const code = translated ? /srclc:([a-z]{3})/.exec(c[25] ?? "")?.[1] : "eng";
  return { url, domain: c[3] || new URL(url).hostname, title, lang: code ? (LANG[code] ?? null) : null, publishedAt, town: { name: town.name, lat: town.lat, lon: town.lon } };
}

/**
 * Every line of every file in a GDELT zip, unzipped and decoded a chunk at a time. Unzipping a whole day's files
 * into strings ran the daily job out of memory.
 */
export function forEachLine(bytes: Uint8Array, onLine: (line: string) => void): void {
  const unzip = new Unzip((file) => {
    const decoder = new TextDecoder();
    let rest = "";
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      const lines = (rest + decoder.decode(chunk, { stream: !final })).split("\n");
      rest = final ? "" : lines.pop()!;
      for (const line of lines) if (line) onLine(line);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.push(bytes, true);
}

export async function runLocal(db: Db, date: RunDate, perRegion: number, fetchGdelt: GdeltFetcher = defaultGdeltFetcher, gaz = Gazetteer.load()): Promise<LocalReport> {
  const empty = { files: 0, filesMissing: 0, filesFailed: 0, articles: 0, regionsEmpty: 0, regionsFilled: 0, stories: 0 };
  // Re-running the day replaces its local stories, and the map below must not count the old ones as coverage.
  await db.delete(localStories).where(eq(localStories.runDate, date));
  if (perRegion === 0) return { ...empty, skipped: "GDELT_PER_REGION is 0" };

  // A region counts as reached when any story on the day's map sits in it, the way the coverage count sees it.
  const map = await loadMapView(db, date);
  const reached = new Set<string>();
  for (const p of new Set(map.items.map((i) => i.place))) {
    const place = map.places[p];
    const region = place ? gaz.areaAt(place.lat, place.lon)?.region : null;
    if (region) reached.add(region);
  }
  const regionsEmpty = gaz.regions().filter((r) => !reached.has(r)).length;

  const { from, to } = ingestWindow(date);
  const picked = new Map<string, (GkgArticle & { at: { name: string; lat: number; lon: number } })[]>();
  const seen = new Set<string>();
  let articles = 0;
  const take = (a: GkgArticle) => {
    if (seen.has(a.url) || a.publishedAt < from || a.publishedAt >= to) return;
    seen.add(a.url);
    const area = gaz.areaAt(a.town.lat, a.town.lon);
    if (!area?.region || reached.has(area.region)) return;
    const at = gaz.locate({ city: a.town.name, country: area.country, lat: a.town.lat, lon: a.town.lon });
    if (!at) return;
    articles += 1;
    const list = picked.get(area.region) ?? [];
    const key = a.title.toLowerCase();
    if (list.some((x) => x.title.toLowerCase() === key)) return;
    list.push({ ...a, at });
    // Newest first, as every list on the site is; only the newest few are kept.
    list.sort((x, y) => y.publishedAt.getTime() - x.publishedAt.getTime());
    if (list.length > perRegion) list.length = perRegion;
    picked.set(area.region, list);
  };

  const urls = gdeltFileUrls(date);
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
  // GDELT unreachable is an outage, not a quiet day: say so instead of writing nothing.
  if (filesFailed > 0 && filesFailed + filesMissing === urls.length) throw new Error(`local: none of the ${urls.length} GDELT files could be read`);

  const rows = [...picked].flatMap(([region, list]) =>
    list.map((a) => ({ runDate: date, url: a.url, title: a.title, domain: a.domain.replace(/^www\./, ""), lang: a.lang, publishedAt: a.publishedAt, placeName: a.at.name, lat: a.at.lat, lon: a.at.lon, region })),
  );
  for (let i = 0; i < rows.length; i += 500) await db.insert(localStories).values(rows.slice(i, i + 500)).onConflictDoNothing();
  return { files: urls.length, filesMissing, filesFailed, articles, regionsEmpty, regionsFilled: picked.size, stories: rows.length };
}
