// Where a story happened, as a point on the map (decision 44). The model names the city; code decides the point.
// A city on the fixed list (data/places.json, from Natural Earth) gets the list's point. A town that isn't on it is
// looked up by name on the town list (data/towns.txt, GeoNames' places of 500 people or more) in the country the model
// named and gets that list's own point; among several of one name the one nearest the model's point decides, and
// with no point to decide a shared name is left alone. Only a name found nowhere gets the model's point, and only
// where a listed city or town lies close by, so a point in open sea or far from any place is never used. Anything
// else returns null, and the story stays at its outlet's city.
//
// GDELT's local stories are checked against the same lists. A town is matched only by its name near GDELT's own
// point, never by name alone (decisions 67 and 78).
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
/**
 * A point nobody listed by name (the model's, or GDELT's for a town neither list has) is used only when a listed city
 * or town of the same country lies within this distance of it. 20 km is about the radius of a municipality: a place of
 * 500 people or more is then within reach on foot of the point, so it is in inhabited country, while a point in open
 * sea, in a bay, or in empty land far from any settlement is refused. The model's points are rough, so less would
 * refuse true ones; more would let a point many kilometres out in the sea through.
 */
export const NEAR_KM = 20;
/**
 * How far the model's point may be from a listed city or town of the name it gave, and still decide between places
 * of that name. The model's points for places it names are a few kilometres off at worst; same-named places of one
 * country are seldom this close, so the point tells them apart. Beyond it the point and the name disagree.
 */
export const NAME_KM = 50;
/**
 * Same-named towns this close together, with no point to choose between them, are one place (GeoNames lists a
 * village and its hamlet, or two spellings of one town, side by side). The first one stands for them.
 */
const ONE_PLACE_KM = 5;
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

  /** The city list alone, for tests and tools that need no towns. The stages use `loadWithTowns`. */
  static load(file = join(DATA, "places.json")): Gazetteer {
    return new Gazetteer(JSON.parse(readFileSync(file, "utf8")) as Row[]);
  }

  /**
   * The city list and GeoNames' places of 500 people or more: what the grouping model's towns and GDELT's towns are
   * placed and checked against (decisions 44, 67 and 78).
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
   * Where a named place is. Two modes.
   *
   * The grouping model's stories (the default), whose points are rough and whose country is the one it named:
   * 1. The name is looked up in that country on the city list and the town list. With a point, the listed place of
   *    that name nearest it decides, within NAME_KM, so a coastal town the model points at in the sea gets the town's
   *    own coordinates. Without one, or when none is that close, a listed city is taken (the largest of that name).
   * 2. A name only towns carry and no point to choose with is placed only when every town of it is one place (within
   *    ONE_PLACE_KM); several towns of one name are ambiguous, so nothing is placed. A name found in the country
   *    whose towns all lie beyond NAME_KM of the point is not guessed either.
   * 3. A name found only in another country (a territory the lists code differently) is taken when the point is near
   *    it (city or town), or when there is no point and it is a listed city.
   * 4. A name found nowhere: the model's own point, only when a listed city or town of the country lies within
   *    NEAR_KM of it.
   *
   * With `nearest`, for GDELT's precise points (decisions 54 and 67): a name several listed places share is read as
   * the one nearest the given point, within SAME_TOWN_KM, in any country; otherwise the point decides as in 4.
   */
  locate(where: Where | null | undefined, nearest = false): Located | null {
    const city = where?.city?.trim();
    if (!city || city.length > 80) return null;
    const cc = (where?.country ?? "").trim().toUpperCase();
    const key = norm(city);
    const { lat, lon } = where ?? {};
    const point =
      typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
    const hit = nearest ? this.byNameNearPoint(key, cc, point) : this.byNameForModel(key, cc, point);
    const name = city.replace(/\s+/g, " ");
    const safe = /^[\p{L}\p{M}0-9' .-]+$/u.test(name);
    if (hit !== undefined) {
      if (!hit) return null;
      // A town's GeoNames spelling can carry transliteration marks ("Rafaḩ"). When the name given is the same
      // name without them, the name given is the label; the city list's own spelling always stands.
      return { name: hit.town && safe && norm(hit.name) === key ? name : hit.name, lat: hit.lat, lon: hit.lon };
    }
    // No list has the name: the point stands only where a listed place of the country is close by.
    if (!point || this.nearest(point.lat, point.lon, NEAR_KM, (e) => e.cc === cc) === null) return null;
    return safe ? { name, lat: Math.round(point.lat * 1000) / 1000, lon: Math.round(point.lon * 1000) / 1000 } : null;
  }

  /** GDELT's mode: the listed place of that name nearest its point, or the largest when it gave none. `undefined`: no list has it. */
  private byNameNearPoint(key: string, cc: string, point: { lat: number; lon: number } | null): Entry | null | undefined {
    // Main names first. An alternate name counts only within the named country: the list's alternates are loose.
    const named = this.byName.get(key) ?? [];
    const alternates = (this.byAlt.get(key) ?? []).filter((e) => e.cc === cc);
    const hit = point ? this.closestWithin([...named, ...alternates], point, SAME_TOWN_KM) : (this.pick(named, cc) ?? this.pick(alternates, cc));
    return hit ?? undefined;
  }

  /** The model's mode, steps 1 to 3 of `locate`. `undefined`: no list has the name, so the point may stand. */
  private byNameForModel(key: string, cc: string, point: { lat: number; lon: number } | null): Entry | null | undefined {
    // A country no list knows (or none given) cannot tell places apart: every place of the name counts.
    const known = cc !== "" && (this.byCountry.has(cc) || this.townOnly.has(cc));
    // Natural Earth gives no country code for a few cities in disputed areas: they answer to any country.
    const here = (e: Entry) => !known || e.cc === cc || e.cc === "";
    const named = this.byName.get(key) ?? [];
    const inCountry = named.filter(here);
    // Main names first, as for GDELT. An alternate name counts only within the named country.
    const local = inCountry.length ? inCountry : (this.byAlt.get(key) ?? []).filter((e) => e.cc === cc);
    if (local.length) {
      const close = point ? this.closestWithin(local, point, NAME_KM) : null;
      if (close) return close;
      const cities = local.filter((e) => !e.town);
      if (cities.length) return this.pick(cities, cc);
      // Only towns carry the name, and the point (if any) is near none of them.
      return point ? null : this.onePlace(local);
    }
    const away = named.filter((e) => !here(e));
    if (away.length) {
      // With no point, only a listed city counts: there are too many same-named towns across the world to take one.
      const hit = point ? this.closestWithin(away, point, NAME_KM) : this.pick(away.filter((e) => !e.town), cc);
      if (hit) return hit;
    }
    return undefined;
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
  /** Whether a listed city or town of `cc` lies within `km` of the point. */
  hasPlaceNear(lat: number, lon: number, km: number, cc: string): boolean {
    return this.nearest(lat, lon, km, (e) => e.cc === cc) !== null;
  }

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

  /** The place of a list nearest a point, within `maxKm`. */
  private closestWithin(list: Entry[], point: { lat: number; lon: number }, maxKm: number): Entry | null {
    let best: Entry | null = null;
    let bestKm = maxKm;
    for (const e of list) {
      const d = km(point.lat, point.lon, e.lat, e.lon);
      if (d <= bestKm && (!best || d < bestKm)) [best, bestKm] = [e, d];
    }
    return best;
  }

  /** Same-named places that are all one place (within ONE_PLACE_KM of the first), else none: the name is ambiguous. */
  private onePlace(list: Entry[]): Entry | null {
    const first = list[0];
    return first && list.every((e) => km(first.lat, first.lon, e.lat, e.lon) <= ONE_PLACE_KM) ? first : null;
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
