import { describe, expect, it } from "vitest";
import type { MapFile } from "@2dayai/core";
import { coverageLine, coverageOf, coverageReport } from "./coverage.js";
import { Gazetteer } from "./places.js";

describe("the daily coverage count (decisions 46 and 78)", () => {
  const map = {
    places: [
      { id: "a", name: "Paris", lat: 48.87, lon: 2.33 },
      { id: "b", name: "Lyon", lat: 45.76, lon: 4.84 },
      { id: "c", name: "Nairobi", lat: -1.29, lon: 36.82 },
      { id: "d", name: "Empty", lat: 35.68, lon: 139.69 },
      // A GeoNames town of a few thousand people, and a point no list names, far from any town.
      { id: "e", name: "Ikinu", lat: -1.11, lon: 36.79 },
      { id: "f", name: "Somewhere", lat: -1.6, lon: 36.3 },
    ],
    items: [{ place: 0 }, { place: 1 }, { place: 2 }, { place: 2 }, { place: 4 }, { place: 5 }],
  } as unknown as MapFile;

  it("counts countries and regions with a story, and names the ones without", () => {
    const c = coverageOf(map, Gazetteer.load());
    expect(c.countries).toBe(2);
    expect(c.regions).toBe(3);
    expect(c.countriesTotal).toBeGreaterThan(200);
    expect(c.missing).toContain("JP (Tokyo)");
    expect(c.missing.some((m) => m.startsWith("FR"))).toBe(false);
    // Every region with no story is listed with its largest city and point, for outlet research.
    expect(c.missingRegions).toHaveLength(c.regionsTotal - c.regions);
    expect(c.missingRegions.find((r) => r.startsWith("JP/"))).toMatch(/^JP\/.+ \(.+, -?\d+\.\d\d, -?\d+\.\d\d\)$/);
    expect(c.missingRegions.some((r) => r.startsWith("KE/Nairobi"))).toBe(false);
  });

  it("counts the listed towns and cities with a story out of every one on the lists", () => {
    const gaz = Gazetteer.loadWithTowns();
    const c = coverageOf(map, gaz);
    expect(c).toMatchObject({ towns: 4, offList: 1 });
    expect(c.townsTotal).toBe(gaz.size());
    expect(c.townsTotal).toBeGreaterThan(200_000);
    expect(coverageLine(c)).toMatch(/^Coverage: stories in 4 of 2\d\d,\d\d\d listed towns and cities \(and 1 other places\), 2 of 2\d\d countries and territories, and \d of 2,\d\d\d regions\.$/);
    expect(coverageReport("2026-09-30", c)).toContain("\nJP (Tokyo)\n");
  });

  it("counts a story in a territory only the town list has against a total that includes it", () => {
    const gaz = Gazetteer.loadWithTowns();
    const pristina = { places: [{ id: "k", name: "Pristina", lat: 42.66, lon: 21.16 }], items: [{ place: 0 }] } as unknown as MapFile;
    const c = coverageOf(pristina, gaz);
    expect(c.countries).toBe(1);
    expect(c.countries + c.missing.length).toBe(c.countriesTotal);
    expect(c.missing.some((m) => m.startsWith("XK"))).toBe(false);
    const both = coverageOf(map, gaz);
    expect(both.countries + both.missing.length).toBe(both.countriesTotal);
    expect(both.missing.some((m) => m.startsWith("XK "))).toBe(true);
  });
});
