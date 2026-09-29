// Where a story happened, as a point on the map (decision 44). The model names the city; code decides the point.
// A city on the fixed list (data/places.json, from Natural Earth) gets the list's point. A town that isn't on it
// gets the model's point only when it sits near a listed city of the same country. Anything else returns null,
// and the story stays at its outlet's city.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The model's answer for one event: the city, its ISO 3166-1 alpha-2 country code and a rough point. */
export type Where = { city: string; country?: string | null | undefined; lat?: number | null | undefined; lon?: number | null | undefined };
export type Located = { name: string; lat: number; lon: number };

type Row = [name: string, cc: string, lat: number, lon: number, pop: number, alts: string[], region?: string];
type Entry = { name: string; cc: string; lat: number; lon: number; pop: number; region: string };

/** How close an unlisted town must be to a listed city of the same country for the model's point to be used. */
export const NEAR_KM = 250;
/** How far a listed city may be from a given point and still be taken as that town, when asked for the nearest. */
const SAME_TOWN_KM = 100;
/** Grid cell size in degrees for finding cities near a point. */
const CELL = 2;
const cellOf = (lat: number, lon: number) => `${Math.floor(lat / CELL)},${Math.floor(lon / CELL)}`;

const norm = (s: string) =>
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

export class Gazetteer {
  private byName = new Map<string, Entry[]>();
  private byAlt = new Map<string, Entry[]>();
  private byCountry = new Map<string, Entry[]>();
  private grid = new Map<string, Entry[]>();

  constructor(rows: Row[]) {
    const add = (map: Map<string, Entry[]>, key: string, e: Entry) => {
      if (!key) return;
      const list = map.get(key) ?? [];
      if (!list.includes(e)) list.push(e);
      map.set(key, list);
    };
    for (const [name, cc, lat, lon, pop, alts, region] of rows) {
      const e = { name, cc, lat, lon, pop, region: region ?? "" };
      add(this.byName, norm(name), e);
      for (const a of alts) add(this.byAlt, norm(a), e);
      add(this.byCountry, cc, e);
      add(this.grid, cellOf(lat, lon), e);
    }
  }

  static load(file = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "places.json")): Gazetteer {
    return new Gazetteer(JSON.parse(readFileSync(file, "utf8")) as Row[]);
  }

  /**
   * With `nearest`, a name several listed cities share is read as the one nearest the given point, and only within
   * SAME_TOWN_KM of it; otherwise the point decides, as for an unlisted town. For GDELT's precise points
   * (decision 54). Without it, the largest of the same-named cities in the country is taken, as the model's points
   * are rough.
   */
  locate(where: Where | null | undefined, nearest = false): Located | null {
    const city = where?.city?.trim();
    if (!city || city.length > 80) return null;
    const cc = (where?.country ?? "").trim().toUpperCase();
    const key = norm(city);
    const { lat, lon } = where ?? {};
    const point = typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    // Main names first. An alternate name counts only within the named country: the list's alternates are loose.
    const named = this.byName.get(key) ?? [];
    const alternates = (this.byAlt.get(key) ?? []).filter((e) => e.cc === cc);
    const listed =
      nearest && point
        ? this.closest([...named, ...alternates].filter((e) => km(point.lat, point.lon, e.lat, e.lon) <= SAME_TOWN_KM), point)
        : (this.pick(named, cc) ?? this.pick(alternates, cc));
    if (listed) return { name: listed.name, lat: listed.lat, lon: listed.lon };
    if (!point || Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) return null;
    const near = this.around(point.lat, point.lon, NEAR_KM).some((e) => e.cc === cc && km(point.lat, point.lon, e.lat, e.lon) <= NEAR_KM);
    const name = city.replace(/\s+/g, " ");
    return near && /^[\p{L}\p{M}0-9' .-]+$/u.test(name) ? { name, lat: Math.round(point.lat * 1000) / 1000, lon: Math.round(point.lon * 1000) / 1000 } : null;
  }

  /** Every country code on the list: the denominator of the daily coverage count. */
  countries(): string[] {
    return [...this.byCountry.keys()].filter(Boolean).sort();
  }

  /** Every first-level region on the list, as "CC/Region": the denominator of the region count. */
  regions(): string[] {
    return [...new Set([...this.byCountry.values()].flat().filter((e) => e.cc && e.region).map((e) => `${e.cc}/${e.region}`))].sort();
  }

  /**
   * The country code and "CC/Region" of the listed city nearest a point, within 300 km, for the daily coverage
   * count only (decision 46). Never shown on the site.
   */
  areaAt(lat: number, lon: number): { country: string; region: string | null } | null {
    let best: Entry | null = null;
    let bestKm = 300;
    for (const e of this.around(lat, lon, bestKm)) {
      const d = km(lat, lon, e.lat, e.lon);
      if (d < bestKm) [best, bestKm] = [e, d];
    }
    if (!best?.cc) return null;
    return { country: best.cc, region: best.region ? `${best.cc}/${best.region}` : null };
  }

  countryAt(lat: number, lon: number): string | null {
    return this.areaAt(lat, lon)?.country ?? null;
  }

  /** The largest listed city of a country, to name it in the coverage report. */
  largestIn(cc: string): string {
    return (this.byCountry.get(cc) ?? []).reduce<Entry | null>((a, b) => (!a || b.pop > a.pop ? b : a), null)?.name ?? cc;
  }

  /** Listed cities in the grid cells that can hold a point within `radiusKm`. A superset: callers measure. */
  private around(lat: number, lon: number, radiusKm: number): Entry[] {
    const dLat = Math.ceil(radiusKm / (111 * CELL)) + 1;
    const cos = Math.max(Math.cos((Math.min(89, Math.abs(lat)) * Math.PI) / 180), 0.01);
    const dLon = Math.min(Math.ceil(180 / CELL), Math.ceil(radiusKm / (111 * CELL * cos)) + 1);
    const [cy, cx] = [Math.floor(lat / CELL), Math.floor(lon / CELL)];
    const cols = 360 / CELL;
    const out: Entry[] = [];
    const seenCols = new Set<number>();
    for (let x = cx - dLon; x <= cx + dLon; x++) {
      const col = ((x % cols) + cols) % cols;
      if (seenCols.has(col)) continue;
      seenCols.add(col);
      const lonCell = col >= cols / 2 ? col - cols : col;
      for (let y = cy - dLat; y <= cy + dLat; y++) out.push(...(this.grid.get(`${y},${lonCell}`) ?? []));
    }
    return out;
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
