// How much of the world a day's map covers (decisions 46 and 78): towns, countries and first-level regions with at
// least one story, counted from where each story sits, and the countries and territories with none, so outlet
// research can go where the map is empty. For the daily summary and `stage -- coverage` only; the site never names
// countries or regions.
import type { MapFile } from "@2dayai/core";
import type { Gazetteer } from "./places.js";

export type Coverage = {
  /** Towns and cities on the lists (the city list and GeoNames' places of 1,000 or more) with a story. */
  towns: number;
  townsTotal: number;
  /**
   * Places with a story more than 5 km from every listed town: an outlet pinned away from its city's listed point,
   * or GDELT's own point for a town no list names.
   */
  offList: number;
  countries: number;
  countriesTotal: number;
  regions: number;
  regionsTotal: number;
  /** Countries and territories with no story at all, each as its code and largest listed city (or first town). */
  missing: string[];
  /** First-level regions with no story, as "CC/Region (largest listed city, lat, lon)", for outlet research. */
  missingRegions: string[];
};

/** Pass the whole day (loadMapView), local stories included, and the gazetteer with towns for the town count. */
export function coverageOf(map: MapFile, gaz: Gazetteer): Coverage {
  const countries = new Set<string>();
  const regions = new Set<string>();
  const towns = new Set<string>();
  let offList = 0;
  const seen = new Set<number>();
  for (const it of map.items) {
    if (seen.has(it.place)) continue;
    seen.add(it.place);
    const p = map.places[it.place];
    if (!p) continue;
    const town = gaz.placeAt(p.lat, p.lon, 5);
    if (town) towns.add(town);
    else offList += 1;
    const area = gaz.areaAt(p.lat, p.lon);
    if (!area) continue;
    countries.add(area.country);
    if (area.region) regions.add(area.region);
  }
  // Both counts come from the one list, so the countries with a story and the ones without always add up to it.
  const all = gaz.countries();
  const missing = all.filter((c) => !countries.has(c)).map((c) => `${c} (${gaz.largestIn(c)})`);
  const allRegions = gaz.regions();
  const missingRegions = allRegions
    .filter((r) => !regions.has(r))
    .map((r) => {
      const c = gaz.largestInRegion(r);
      return c ? `${r} (${c.name}, ${c.lat.toFixed(2)}, ${c.lon.toFixed(2)})` : r;
    });
  return { towns: towns.size, townsTotal: gaz.size(), offList, countries: all.length - missing.length, countriesTotal: all.length, regions: regions.size, regionsTotal: allRegions.length, missing, missingRegions };
}

const n = (x: number) => x.toLocaleString("en-US");

/** The coverage line of the daily summary, and the first line of `stage -- coverage`. */
export function coverageLine(c: Coverage): string {
  const off = c.offList ? ` (and ${n(c.offList)} other places)` : "";
  return `Coverage: stories in ${n(c.towns)} of ${n(c.townsTotal)} listed towns and cities${off}, ${c.countries} of ${c.countriesTotal} countries and territories, and ${n(c.regions)} of ${n(c.regionsTotal)} regions.`;
}

/** `stage -- coverage`: the line, then every country and territory, and every region, with no story, for outlet research. */
export function coverageReport(date: string, c: Coverage): string {
  const none = c.missing.length ? `No story in ${c.missing.length} countries and territories (code and largest listed city):\n${c.missing.join("\n")}` : "Every country and territory on the list has a story.";
  const regions = c.missingRegions.length ? `No story in ${c.missingRegions.length} first-level regions (region, then its largest listed city and point):\n${c.missingRegions.join("\n")}` : "Every first-level region on the list has a story.";
  return `${date}\n${coverageLine(c)}\n\n${none}\n\n${regions}\n`;
}
