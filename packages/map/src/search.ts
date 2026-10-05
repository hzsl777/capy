// Find a place: what the search box matches, and in what order. Pure, so it is unit tested. It lists only places that
// have reports in today's data (the site does not ship a town list), and it orders them only by how well the name
// matches and then by name: never by importance, report count or anything about the news (neutrality rule 3).
import type { MapFile, MapNames } from "./types.ts";
import { tierOf, TIERS } from "./data.ts";

/** A place the search can find. */
export type PlaceEntry = {
  id: string;
  name: string;
  /** The name as matching sees it (see `fold`). */
  key: string;
  lat: number;
  lon: number;
  /** How many reports the place has today. */
  reports: number;
  /** The zoom level at which the place shows (decision 30), so a flight can land where it is on the map. */
  tier: number;
  /** Its index in the day's places when the page already holds it, otherwise it lives in a tile not loaded yet. */
  index?: number;
};

/** A place's id from its point, as the pipeline makes it (`placeIdFor` in core; the site imports core's types only). */
export const placeIdOf = (lat: number, lon: number): string => `ll:${lat.toFixed(2)},${lon.toFixed(2)}`;

/** The most results shown at once. */
export const MAX_RESULTS = 8;

// Letters with no accent to strip that a reader types as their plain neighbour.
const PLAIN: Record<string, string> = { ø: "o", đ: "d", ð: "d", ł: "l", ħ: "h", ı: "i", ß: "ss", æ: "ae", œ: "oe", þ: "th", ŋ: "n", ĸ: "k" };

/**
 * A name as matching sees it: lower case, accents and marks taken off ("São Paulo" is "sao paulo"), apostrophes
 * dropped ("O'Fallon" is "ofallon"), every other run of marks, hyphens and spaces one space. Letters and numbers of any
 * script stay, so a name in another script still matches itself.
 */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[øđðłħıßæœþŋĸ]/g, (c) => PLAIN[c]!)
    .replace(/['’‘ʼ`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** How well a folded name matches a folded query: 0 the same, 1 starts with it, 2 has it inside, 3 does not match. */
export function rank(key: string, query: string): 0 | 1 | 2 | 3 {
  if (!query) return 3;
  if (key === query) return 0;
  if (key.startsWith(query)) return 1;
  return key.includes(query) ? 2 : 3;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The places whose name matches, at most `limit`: exact matches first, then names that start with the query, then
 * names that have it inside, and alphabetically within each. Places of one name stay apart in a fixed order (their
 * own name, then latitude and longitude), so the same query always lists the same places in the same order. `more`
 * is how many matches there were beyond the ones returned. `skip` leaves out a match (a place listed twice).
 */
export function searchPlaces(entries: readonly PlaceEntry[], query: string, limit = MAX_RESULTS, skip?: (e: PlaceEntry) => boolean): { shown: PlaceEntry[]; more: number } {
  const q = fold(query);
  if (!q) return { shown: [], more: 0 };
  const hits: { e: PlaceEntry; r: number }[] = [];
  for (const e of entries) {
    const r = rank(e.key, q);
    // `skip` is asked only of a match, so a long list costs a comparison each, not a lookup.
    if (r < 3 && !skip?.(e)) hits.push({ e, r });
  }
  hits.sort((a, b) => a.r - b.r || byText(a.e.key, b.e.key) || byText(a.e.name, b.e.name) || a.e.lat - b.e.lat || a.e.lon - b.e.lon);
  return { shown: hits.slice(0, limit).map((h) => h.e), more: Math.max(0, hits.length - limit) };
}

/**
 * Places in the day's file, each with its reports counted over the whole day (not the replay's moment or the topics on,
 * so a place is found whatever the map shows now) and the zoom level it shows at. A place with no report is left out.
 */
export function entriesFromFile(file: MapFile, tiered: boolean): PlaceEntry[] {
  const reports = new Array<number>(file.places.length).fill(0);
  const tier = new Array<number>(file.places.length).fill(TIERS);
  for (const it of file.items) {
    reports[it.place]! += 1;
    tier[it.place] = Math.min(tier[it.place]!, tierOf(it, tiered));
  }
  const out: PlaceEntry[] = [];
  file.places.forEach((p, index) => {
    if (reports[index]) out.push({ id: p.id, name: p.name, key: fold(p.name), lat: p.lat, lon: p.lon, reports: reports[index]!, tier: tier[index]!, index });
  });
  return out;
}

/**
 * Places from the names index (the towns of tiles not loaded yet). Local stories show only at the closest zoom, which is
 * the last tier. A row that is not a name and a point is skipped, so a damaged file lists what it can; a town the page
 * already holds is left out when searching (`skip` in searchPlaces), as its own entry covers it.
 */
export function entriesFromNames(names: MapNames): PlaceEntry[] {
  if (!names || names.version !== 2 || !Array.isArray(names.places)) return [];
  const out: PlaceEntry[] = [];
  for (const row of names.places) {
    if (!Array.isArray(row)) continue;
    const [name, lat, lon, reports] = row;
    if (typeof name !== "string" || !name.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({ id: placeIdOf(lat, lon), name, key: fold(name), lat, lon, reports: Number.isFinite(reports) ? reports : 1, tier: TIERS - 1 });
  }
  return out;
}

/** "1 report", "3 reports". */
export const reportsLabel = (n: number): string => `${n} ${n === 1 ? "report" : "reports"}`;

/** A latitude and longitude as a reader reads them: "39.80 N, 89.64 W". */
export function coordsLabel(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(2)} ${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(2)} ${lon < 0 ? "W" : "E"}`;
}

/**
 * What tells results of one name apart. Rule 2 keeps a place's name from ever appearing with a country or a region,
 * so places that share a name in the list are told apart by their coordinates, and only then; a name that is alone in
 * the list shows no more than its report count. Returns, per result, the coordinates or null.
 */
export function tellApart(shown: readonly PlaceEntry[]): (string | null)[] {
  const seen = new Map<string, number>();
  for (const e of shown) seen.set(e.key, (seen.get(e.key) ?? 0) + 1);
  return shown.map((e) => (seen.get(e.key)! > 1 ? coordsLabel(e.lat, e.lon) : null));
}

/** The address of the day's names index, next to its tiles; null when the file's index names a folder the site never uses. */
export function namesUrl(dataBase: string, index: { base: string; names?: true } | undefined): string | null {
  if (!index?.names || !/^local\/[\w-]+\/$/.test(index.base)) return null;
  return `${dataBase}data/${index.base}names.json`;
}
