import { describe, expect, it } from "vitest";
import type { MapFile } from "@2dayai/core";
import { coverageOf } from "./coverage.js";
import { Gazetteer } from "./places.js";

describe("the daily coverage count (decision 46)", () => {
  it("counts countries and regions with a story, and names the ones without", () => {
    const map = {
      places: [
        { id: "a", name: "Paris", lat: 48.87, lon: 2.33 },
        { id: "b", name: "Lyon", lat: 45.76, lon: 4.84 },
        { id: "c", name: "Nairobi", lat: -1.29, lon: 36.82 },
        { id: "d", name: "Empty", lat: 35.68, lon: 139.69 },
      ],
      items: [{ place: 0 }, { place: 1 }, { place: 2 }, { place: 2 }],
    } as unknown as MapFile;
    const c = coverageOf(map, Gazetteer.load());
    expect(c.countries).toBe(2);
    expect(c.regions).toBe(3);
    expect(c.countriesTotal).toBeGreaterThan(200);
    expect(c.missing).toContain("JP (Tokyo)");
    expect(c.missing.some((m) => m.startsWith("FR"))).toBe(false);
  });
});
