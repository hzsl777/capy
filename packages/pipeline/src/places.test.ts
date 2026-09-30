import { describe, expect, it } from "vitest";
import { Gazetteer, km } from "./places.js";

const gaz = Gazetteer.load();

describe("placing a story where it happened (decision 44)", () => {
  it("uses the list's point for a listed city, telling same-named cities apart by country", () => {
    expect(gaz.locate({ city: "Paris", country: "FR" })).toMatchObject({ name: "Paris" });
    expect(gaz.locate({ city: "Paris", country: "FR" })!.lat).toBeCloseTo(48.87, 1);
    expect(gaz.locate({ city: "Odessa", country: "UA" })!.lon).toBeGreaterThan(30);
    expect(gaz.locate({ city: "Odessa", country: "US" })!.lon).toBeLessThan(-90);
    // No country, or a code the list doesn't use: the largest city of that name.
    expect(gaz.locate({ city: "Paris" })!.lon).toBeGreaterThan(0);
  });

  it("matches spellings the list knows, and alternates only within the named country", () => {
    expect(gaz.locate({ city: "Kiev", country: "UA" })).toMatchObject({ name: "Kyiv" });
    expect(gaz.locate({ city: "São Paulo", country: "BR" })).toMatchObject({ name: "São Paulo" });
    expect(gaz.locate({ city: "Sao Paulo", country: "BR" })).toMatchObject({ name: "São Paulo" });
    // Goma's list entry carries "Gisenyi" as an alternate, a different city across a border. The real one wins.
    expect(gaz.locate({ city: "Gisenyi", country: "RW" })).toMatchObject({ name: "Gisenyi" });
  });

  it("uses the model's point for an unlisted town only near a listed city of the same country", () => {
    const rafah = gaz.locate({ city: "Rafah", country: "PS", lat: 31.29, lon: 34.25 });
    expect(rafah).toEqual({ name: "Rafah", lat: 31.29, lon: 34.25 });
    // A point far from anything in the named country is a guess, and the story stays at its outlet.
    expect(gaz.locate({ city: "Nowhere", country: "PS", lat: 0, lon: 0 })).toBeNull();
    expect(gaz.locate({ city: "Rafah", country: "PS" })).toBeNull();
    expect(gaz.locate({ city: "Rafah<script>", country: "PS", lat: 31.29, lon: 34.25 })).toBeNull();
  });

  it("returns nothing when the reporting names no city", () => {
    expect(gaz.locate(null)).toBeNull();
    expect(gaz.locate({ city: "  " })).toBeNull();
  });

  it("names the country of a point for the coverage count, and nothing far out at sea", () => {
    expect(gaz.countryAt(48.85, 2.35)).toBe("FR");
    expect(gaz.countryAt(-1.29, 36.82)).toBe("KE");
    expect(gaz.countryAt(-30, -140)).toBeNull();
    expect(gaz.countries().length).toBeGreaterThan(200);
    expect(gaz.largestIn("FR")).toBe("Paris");
  });

  it("checks GDELT's towns against GeoNames' towns too, by name near GDELT's point only (decision 67)", () => {
    const towns = Gazetteer.loadWithTowns();
    // Rovereto is a GeoNames town, not on the city list: its own name and point.
    expect(towns.locate({ city: "Rovereto", country: "IT", lat: 45.9, lon: 11.03 }, true)).toEqual({ name: "Rovereto", lat: 45.89, lon: 11.04 });
    // A shared name goes to the place nearest GDELT's point, never to a larger namesake elsewhere.
    expect(towns.locate({ city: "Springfield", country: "US", lat: 37.2153, lon: -93.2982 }, true)!.lon).toBeCloseTo(-93.3, 0);
    expect(towns.locate({ city: "Columbus", country: "US", lat: 32.461, lon: -84.9877 }, true)!.lat).toBeCloseTo(32.47, 1);
    // Towns never answer the grouping model's names, which come without a precise point.
    expect(towns.locate({ city: "Rovereto", country: "IT" })).toBeNull();
    expect(towns.locate({ city: "Springfield", country: "US" })).toEqual(gaz.locate({ city: "Springfield", country: "US" }));
    // Towns add no regions, but they add the territories the city list lacks, so a story there counts against a
    // total that includes it.
    expect(towns.regions()).toEqual(gaz.regions());
    expect(towns.countries()).toEqual(expect.arrayContaining(gaz.countries()));
    expect(towns.countries()).toContain("XK");
    expect(gaz.countries()).not.toContain("XK");
    expect(towns.countries().length).toBe(gaz.countries().length + 22);
    expect(towns.countryAt(42.66, 21.16)).toBe("XK");
    expect(towns.largestIn("XK")).not.toBe("XK");
    expect(towns.areaAt(45.89, 11.04)).toEqual({ country: "IT", region: "IT/Trentino-Alto Adige" });
  });

  it("measures distance on the globe", () => {
    expect(km(48.85, 2.35, 51.51, -0.13)).toBeCloseTo(343, -1);
  });
});
