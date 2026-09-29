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
    }
  }

  static load(file = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "places.json")): Gazetteer {
    return new Gazetteer(JSON.parse(readFileSync(file, "utf8")) as Row[]);
  }

  locate(where: Where | null | undefined): Located | null {
    const city = where?.city?.trim();
    if (!city || city.length > 80) return null;
    const cc = (where?.country ?? "").trim().toUpperCase();
    const key = norm(city);
    // Main names first. An alternate name counts only within the named country: the list's alternates are loose.
    const listed = this.pick(this.byName.get(key) ?? [], cc) ?? this.pick((this.byAlt.get(key) ?? []).filter((e) => e.cc === cc), cc);
    if (listed) return { name: listed.name, lat: listed.lat, lon: listed.lon };
    const { lat, lon } = where ?? {};
    if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const near = (this.byCountry.get(cc) ?? []).some((e) => km(lat, lon, e.lat, e.lon) <= NEAR_KM);
    const name = city.replace(/\s+/g, " ");
    return near && /^[\p{L}\p{M}0-9' .-]+$/u.test(name) ? { name, lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 } : null;
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
    for (const list of this.byCountry.values()) {
      for (const e of list) {
        const d = km(lat, lon, e.lat, e.lon);
        if (d < bestKm) [best, bestKm] = [e, d];
      }
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

  /** One city among same-named ones: the one in the named country, else the only one, else the largest. */
  private pick(list: Entry[], cc: string): Entry | null {
    if (list.length === 0) return null;
    const inCountry = list.filter((e) => e.cc === cc);
    const pool = inCountry.length ? inCountry : list;
    return pool.reduce((a, b) => (b.pop > a.pop ? b : a));
  }
}
