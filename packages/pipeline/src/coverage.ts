// How much of the world a day's map covers (decision 46): countries and first-level regions with at least one
// story, counted from where each story sits. For the daily summary only; the site never names countries.
import type { MapFile } from "@2dayai/core";
import type { Gazetteer } from "./places.js";

export type Coverage = { countries: number; countriesTotal: number; regions: number; regionsTotal: number; missing: string[] };

export function coverageOf(map: MapFile, gaz: Gazetteer): Coverage {
  const countries = new Set<string>();
  const regions = new Set<string>();
  const seen = new Set<number>();
  for (const it of map.items) {
    if (seen.has(it.place)) continue;
    seen.add(it.place);
    const p = map.places[it.place];
    const area = p ? gaz.areaAt(p.lat, p.lon) : null;
    if (!area) continue;
    countries.add(area.country);
    if (area.region) regions.add(area.region);
  }
  const all = gaz.countries();
  const missing = all.filter((c) => !countries.has(c)).map((c) => `${c} (${gaz.largestIn(c)})`);
  return { countries: countries.size, countriesTotal: all.length, regions: regions.size, regionsTotal: gaz.regions().length, missing };
}
