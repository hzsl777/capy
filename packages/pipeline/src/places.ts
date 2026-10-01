// Where a story happened, as a point on the map (decision 44). The model names the city; code decides the point.
// A city on the fixed list (data/places.json, from Natural Earth) gets the list's point. A town that isn't on it
// gets the model's point only when it sits near a listed city of the same country. Anything else returns null,
// and the story stays at its outlet's city.
//
// GDELT's local stories are also checked against smaller towns (data/towns.txt, GeoNames' places of 1,000 people or
// more, decisions 67 and 78). A town is matched only by its name near GDELT's own point, never by name alone, and
// towns never change where the grouping model's stories go.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The model's answer for one event: the city, its ISO 3166-1 alpha-2 country code and a rough point. */
export type Where = { city: string; country?: string | null | undefined; lat?: number | null | undefined; lon?: number | null | undefined };
export type Located = { name: string; lat: number; lon: number };

type Row = [name: string, cc: string, lat: number, lon: number, pop: number, alts: string[], region?: string];
/** One town of data/towns.txt, built by scripts/build-towns.ts. */
export type Town = [name: string, cc: string, lat: number, lon: number, region: string];
type Entry = { name: string; cc: string; lat: number; lon: number; pop: number; region: string; town: boolean };

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
/** How close an unlisted town must be to a listed city of the same country for the model's point to be used. */
export const NEAR_KM = 250;
/**
 * How far a listed city or town may be from a given point and still be taken as that place, when asked for the
 * nearest. Two gazetteers' points for one town are this close; a same-named neighbour usually is not.
 */
const SAME_TOWN_KM = 30;
/** Grid cell size in degrees for finding places near a point. */
const CELL = 0.5;
const COLS = 360 / CELL;
const KM_PER_DEG = (12742 / 2) * (Math.PI / 180);
const cellKey = (y: number, x: number) => y * COLS + (((x % COLS) + COLS) % COLS);

export const norm = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^(the|al|el)[\s-]+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Natural Earth spells some first-level regions two ways in one country: right ("Béchar", "Goiás") and garbled, with
 * each accented letter replaced by a wrong ASCII one ("BZchar") or the name cut off at one ("Goi"). Left alone, one
 * region counts twice and its garbled half is listed as having no story. This maps each garbled spelling to the right
 * one: an all-ASCII name of three letters or more that matches exactly one accented name of the same country wherever
 * that name's letter is ASCII, and either has its length or stops just before one of its accented letters.
 */
export function regionSpellings(pairs: Iterable<[cc: string, region: string]>): Map<string, string> {
  const byCountry = new Map<string, Set<string>>();
  for (const [cc, region] of pairs) if (region) byCountry.set(cc, (byCountry.get(cc) ?? new Set()).add(region));
  const ascii = (s: string) => /^[\x00-\x7f]*$/.test(s);
  const out = new Map<string, string>();
  for (const [cc, names] of byCountry) {
    const accented = [...names].filter((n) => !ascii(n));
    for (const bad of names) {
      if (!ascii(bad)) continue;
      if (bad.length < 3) continue;
      const fits = (g: string) =>
        g.length >= bad.length &&
        [...bad].every((c, i) => c === g[i] || !ascii(g[i]!)) &&
        (g.length === bad.length || !ascii(g[bad.length]!));
      const matches = accented.filter(fits);
      if (matches.length === 1) out.set(`${cc}/${bad}`, matches[0]!);
    }
  }
  return out;
}

export class Gazetteer {
  private byName = new Map<string, Entry[]>();
  private byAlt = new Map<string, Entry[]>();
  private byCountry = new Map<string, Entry[]>();
  private grid = new Map<number, Entry[]>();
  /** Countries and territories only the town list has (Kosovo, Jersey, Anguilla...), each with its first town. */
  private townOnly = new Map<string, string>();

  /** How many towns were loaded beside the city list. */
  readonly townCount: number;

  constructor(rows: Row[], towns: Town[] = []) {
    const spelled = regionSpellings(rows.map((r) => [r[1], r[6] ?? ""]));
    const fix = (cc: string, region: string) => spelled.get(`${cc}/${region}`) ?? region;
    for (const [name, cc, lat, lon, pop, alts, region] of rows) {
      const e: Entry = { name, cc, lat, lon, pop, region: fix(cc, region ?? ""), town: false };
      this.add(e);
      for (const a of new Set(alts.map(norm))) push(this.byAlt, a, e);
      push(this.byCountry, cc, e);
    }
    // Towns join the name and grid lookups. They add no regions (every town's region is one of the city list's),
    // but they do add 22 countries and territories the city list lacks. `areaAt` can answer with those, so they join
    // the country list too, or the coverage count would count stories in them against a total without them.
    for (const [name, cc, lat, lon, region] of towns) {
      this.add({ name, cc, lat, lon, pop: 0, region: fix(cc, region), town: true });
      if (cc && !this.byCountry.has(cc) && !this.townOnly.has(cc)) this.townOnly.set(cc, name);
    }
    this.townCount = towns.length;
  }

  /** The city list alone: what the grouping stage's places are checked against (decision 44). */
  static load(file = join(DATA, "places.json")): Gazetteer {
    return new Gazetteer(JSON.parse(readFileSync(file, "utf8")) as Row[]);
  }

  /**
   * The city list and GeoNames' places of 1,000 people or more: what GDELT's towns are checked against (decisions 67
   * and 78).
   */
  static loadWithTowns(dir = DATA): Gazetteer {
    return new Gazetteer(JSON.parse(readFileSync(join(dir, "places.json"), "utf8")) as Row[], parseTowns(readFileSync(join(dir, "towns.txt"), "utf8")));
  }

  /** Every place on the list: the cities and, when loaded, the towns. The denominator of the town count. */
  size(): number {
    return [...this.byCountry.values()].reduce((n, l) => n + l.length, 0) + this.townCount;
  }

  /**
   * The listed city or town at a point, within `maxKm`, as a key that is the same for every point near it: how the
   * coverage report counts towns with a story (decision 78).
   */
  placeAt(lat: number, lon: number, maxKm = 2): string | null {
    const e = this.nearest(lat, lon, maxKm);
    return e ? `${e.cc}|${e.name}|${e.lat}|${e.lon}` : null;
  }

  private add(e: Entry) {
    push(this.byName, norm(e.name), e);
    push(this.grid, cellKey(Math.floor(e.lat / CELL), Math.floor(e.lon / CELL)), e);
  }

  /**
   * With `nearest`, a name several listed places share is read as the one nearest the given point, and only within
   * SAME_TOWN_KM of it; otherwise the point decides, as for an unlisted town. For GDELT's precise points
   * (decisions 54 and 67). Without it, the largest of the same-named cities in the country is taken, as the model's
   * points are rough, and towns are never matched.
   */
  locate(where: Where | null | undefined, nearest = false): Located | null {
    const city = where?.city?.trim();
    if (!city || city.length > 80) return null;
    const cc = (where?.country ?? "").trim().toUpperCase();
    const key = norm(city);
    const { lat, lon } = where ?? {};
    const point = typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    // Main names first. An alternate name counts only within the named country: the list's alternates are loose.
    const named = (this.byName.get(key) ?? []).filter((e) => nearest || !e.town);
    const alternates = (this.byAlt.get(key) ?? []).filter((e) => e.cc === cc);
    const listed =
      nearest && point
        ? this.closest([...named, ...alternates].filter((e) => km(point.lat, point.lon, e.lat, e.lon) <= SAME_TOWN_KM), point)
        : (this.pick(named, cc) ?? this.pick(alternates, cc));
    if (listed) return { name: listed.name, lat: listed.lat, lon: listed.lon };
    if (!point || Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) return null;
    const near = this.nearest(point.lat, point.lon, NEAR_KM, (e) => e.cc === cc) !== null;
    const name = city.replace(/\s+/g, " ");
    return near && /^[\p{L}\p{M}0-9' .-]+$/u.test(name) ? { name, lat: Math.round(point.lat * 1000) / 1000, lon: Math.round(point.lon * 1000) / 1000 } : null;
  }

  /** Every country code on the list: the denominator of the daily coverage count. */
  countries(): string[] {
    return [...this.byCountry.keys(), ...this.townOnly.keys()].filter(Boolean).sort();
  }

  /** Every first-level region on the list, as "CC/Region": the denominator of the region count. */
  regions(): string[] {
    return [...new Set([...this.byCountry.values()].flat().filter((e) => e.cc && e.region).map((e) => `${e.cc}/${e.region}`))].sort();
  }

  /**
   * The country code and "CC/Region" of the listed city (or town, when loaded) nearest a point, within 300 km, for
   * the daily coverage count and the local stage's regions (decisions 46 and 54). Never shown on the site.
   */
  areaAt(lat: number, lon: number): { country: string; region: string | null } | null {
    // Natural Earth gives no country code for a dozen cities in disputed areas (Pristina, Hargeisa, Kyrenia); the
    // nearest place that has one answers instead, so their stories count somewhere. Internal only, like the count.
    const best = this.nearest(lat, lon, 300, (e) => e.cc !== "");
    if (!best) return null;
    return { country: best.cc, region: best.region ? `${best.cc}/${best.region}` : null };
  }

  countryAt(lat: number, lon: number): string | null {
    return this.areaAt(lat, lon)?.country ?? null;
  }

  /**
   * The largest listed city of a country, to name it in the coverage report. The town list gives no populations, so a
   * territory only it has is named by its first town.
   */
  /** The largest listed city of a first-level region ("CC/Region"), with its point, to name it in the coverage report. */
  largestInRegion(key: string): { name: string; lat: number; lon: number } | null {
    const cc = key.slice(0, key.indexOf("/"));
    const best = (this.byCountry.get(cc) ?? []).filter((e) => `${e.cc}/${e.region}` === key).reduce<Entry | null>((a, b) => (!a || b.pop > a.pop ? b : a), null);
    return best ? { name: best.name, lat: best.lat, lon: best.lon } : null;
  }

  largestIn(cc: string): string {
    return (this.byCountry.get(cc) ?? []).reduce<Entry | null>((a, b) => (!a || b.pop > a.pop ? b : a), null)?.name ?? this.townOnly.get(cc) ?? cc;
  }

  /**
   * The listed place nearest a point within `maxKm` that `ok` accepts. Grid rows are searched outward from the
   * point's row, and each row outward from the point's column, stopping once no cell further out can hold anything
   * closer than the best so far.
   */
  private nearest(lat: number, lon: number, maxKm: number, ok: (e: Entry) => boolean = () => true): Entry | null {
    const [cy, cx] = [Math.floor(lat / CELL), Math.floor(lon / CELL)];
    let best: Entry | null = null;
    let bestKm = maxKm;
    const scan = (y: number, x: number) => {
      for (const e of this.grid.get(cellKey(y, x)) ?? []) {
        if (!ok(e)) continue;
        const d = km(lat, lon, e.lat, e.lon);
        if (d <= bestKm && (!best || d < bestKm)) [best, bestKm] = [e, d];
      }
    };
    // A cell dy rows away is at least dy - 1 rows of latitude away.
    for (let dy = 0; (dy - 1) * CELL * KM_PER_DEG <= bestKm; dy++) {
      for (const y of dy === 0 ? [cy] : [cy - dy, cy + dy]) {
        if (y < -90 / CELL || y >= 90 / CELL) continue;
        // Along a parallel the gap is smallest at the highest latitude either point can have, and 2 / pi allows
        // for the great circle's shortcut.
        const high = Math.min(89.9, Math.max(Math.abs(lat), Math.abs(y * CELL), Math.abs((y + 1) * CELL)));
        const perCol = CELL * KM_PER_DEG * Math.cos((high * Math.PI) / 180) * (2 / Math.PI);
        for (let dx = 0; dx <= COLS / 2 && (dx - 1) * perCol <= bestKm; dx++) {
          scan(y, cx - dx);
          if (dx > 0) scan(y, cx + dx);
        }
      }
    }
    return best;
  }

  private closest(list: Entry[], point: { lat: number; lon: number }): Entry | null {
    return list.reduce<Entry | null>((a, b) => (!a || km(point.lat, point.lon, b.lat, b.lon) < km(point.lat, point.lon, a.lat, a.lon) ? b : a), null);
  }

  /** One city among same-named ones: the one in the named country, else the only one, else the largest. */
  private pick(list: Entry[], cc: string): Entry | null {
    if (list.length === 0) return null;
    const inCountry = list.filter((e) => e.cc === cc);
    const pool = inCountry.length ? inCountry : list;
    return pool.reduce((a, b) => (b.pop > a.pop ? b : a));
  }
}

function push<K>(map: Map<K, Entry[]>, key: K, e: Entry) {
  if (key === "") return;
  const list = map.get(key);
  if (list) list.push(e);
  else map.set(key, [e]);
}

/**
 * data/towns.txt: "=CC<tab>Region" starts a block, and each line after it is a town, its latitude and longitude in
 * hundredths of a degree counted from the line before (scripts/build-towns.ts, decision 78).
 */
export function parseTowns(text: string): Town[] {
  const out: Town[] = [];
  let cc = "";
  let region = "";
  let [lat, lon] = [0, 0];
  for (const line of text.split("\n")) {
    if (!line || line[0] === "#") continue;
    const f = line.split("\t");
    if (line[0] === "=") {
      [cc, region] = [f[0]!.slice(1), f[1] ?? ""];
      [lat, lon] = [0, 0];
      continue;
    }
    lat += Number(f[1]);
    lon += Number(f[2]);
    out.push([f[0]!, cc, lat / 100, lon / 100, region]);
  }
  return out;
}
