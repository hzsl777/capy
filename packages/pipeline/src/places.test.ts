import { describe, expect, it } from "vitest";
import { Gazetteer, km, NAME_KM, NEAR_KM, regionSpellings } from "./places.js";

const gaz = Gazetteer.load();
// What the grouping stage and the local stage load: the city list and the town list.
const full = Gazetteer.loadWithTowns();

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

  it("uses the model's point for a name no list has only within a few kilometres of a listed place of that country", () => {
    // Neither list has this name. A point near Gaza Strip towns stands; the point is the model's, rounded.
    expect(full.locate({ city: "Fictional Cove", country: "PS", lat: 31.29, lon: 34.25 })).toEqual({ name: "Fictional Cove", lat: 31.29, lon: 34.25 });
    // A point far from anything in the named country is a guess, and the story stays at its outlet.
    expect(full.locate({ city: "Nowhere", country: "PS", lat: 0, lon: 0 })).toBeNull();
    expect(full.locate({ city: "Fictional Cove", country: "PS" })).toBeNull();
    expect(full.locate({ city: "Fictional<script>", country: "PS", lat: 31.29, lon: 34.25 })).toBeNull();
    // GeoNames spells Rafah "Rafaḩ", twice (Gaza Strip and Egypt): the town in the named country, its own point, and
    // the spelling the model gave.
    expect(gaz.locate({ city: "Rafah", country: "PS" })).toBeNull();
    expect(full.locate({ city: "Rafah", country: "PS", lat: 31.29, lon: 34.25 })).toEqual({ name: "Rafah", lat: 31.3, lon: 34.24 });
    // 20 km: a point inside Tabarka's reach stands, one outside does not. Tabarka is at 36.95, 8.76.
    expect(NEAR_KM).toBe(20);
    const reach = (away: number) => ({ city: "Fictional Cove", country: "TN", lat: 36.95 + away / 111.2, lon: 8.76 });
    expect(full.locate(reach(NEAR_KM - 2))).not.toBeNull();
    expect(full.locate(reach(NEAR_KM + 4))).toBeNull();
  });

  it("never uses a guessed point in open sea or far from any place, however near a city of the country is", () => {
    // 90 km off Tunisia's east coast and deep in the Sahara: both used to pass the old 250 km test.
    expect(full.locate({ city: "Nowhereville", country: "TN", lat: 36, lon: 11.7 })).toBeNull();
    expect(full.locate({ city: "Nowhereville", country: "TN", lat: 31.5, lon: 8.5 })).toBeNull();
    expect(full.locate({ city: "Nowhereville", country: "IT", lat: 38.0, lon: 11.5 })).toBeNull();
    // The point is checked against the named country's places only: the sea off Sicily is not Tunisia.
    expect(full.locate({ city: "Nowhereville", country: "TN", lat: 37.35, lon: 12.0 })).toBeNull();
  });

  it("gives a town the model names its own coordinates, not the model's point in the sea", () => {
    // Tabarka (36.95, 8.76), Termoli (42.00, 14.99) and Lampedusa (35.50, 12.61) are on the town list only.
    expect(gaz.locate({ city: "Tabarka", country: "TN" })).toBeNull();
    // The model's point is 22 km off the coast, in the Mediterranean.
    expect(full.locate({ city: "Tabarka", country: "TN", lat: 37.15, lon: 8.7 })).toEqual({ name: "Tabarka", lat: 36.95, lon: 8.76 });
    expect(full.locate({ city: "Termoli", country: "IT", lat: 42.2, lon: 15.2 })).toEqual({ name: "Termoli", lat: 42, lon: 14.99 });
    expect(full.locate({ city: "Lampedusa", country: "IT", lat: 35.4, lon: 12.4 })).toEqual({ name: "Lampedusa", lat: 35.5, lon: 12.61 });
    // With no point the one town of that name in the country is still unambiguous.
    expect(full.locate({ city: "Tabarka", country: "TN" })).toEqual({ name: "Tabarka", lat: 36.95, lon: 8.76 });
    // Spelling is matched the way the city list's is: accents and case do not matter.
    expect(full.locate({ city: "TERMOLI", country: "IT" })).toMatchObject({ lat: 42, lon: 14.99 });
    // A city on the city list still wins over the town list, and keeps the list's point.
    expect(full.locate({ city: "Zarzis", country: "TN", lat: 33.45, lon: 11.35 })).toEqual(gaz.locate({ city: "Zarzis", country: "TN" }));
    // The town's country is the one the model named: Tabarka named in Italy is not placed in Tunisia.
    expect(full.locate({ city: "Tabarka", country: "IT" })).toBeNull();
  });

  it("tells same-named towns of one country apart by the model's point, and leaves an ambiguous name alone", () => {
    // Two Badias in Italy, 400 km apart (42.09, 13.92 and 46.61, 11.90), on neither the city list nor each other's.
    expect(gaz.locate({ city: "Badia", country: "IT" })).toBeNull();
    expect(full.locate({ city: "Badia", country: "IT", lat: 46.65, lon: 11.95 })).toEqual({ name: "Badia", lat: 46.61, lon: 11.9 });
    expect(full.locate({ city: "Badia", country: "IT", lat: 42.1, lon: 13.9 })).toEqual({ name: "Badia", lat: 42.09, lon: 13.92 });
    // No point to decide: ambiguous, so it stays at the outlet.
    expect(full.locate({ city: "Badia", country: "IT" })).toBeNull();
    expect(full.locate({ city: "Badia", country: "IT", lat: null, lon: null })).toBeNull();
    // A point near neither: the name and the point disagree, nothing is guessed (and the point alone is not used).
    expect(full.locate({ city: "Badia", country: "IT", lat: 40.0, lon: 16.0 })).toBeNull();
    expect(NAME_KM).toBe(50);
    // A point 45 km from a Badia is still that Badia; one 60 km is not.
    expect(full.locate({ city: "Badia", country: "IT", lat: 46.61 + 45 / 111.2, lon: 11.9 })).toMatchObject({ lat: 46.61 });
    expect(full.locate({ city: "Badia", country: "IT", lat: 46.61 + 60 / 111.2, lon: 11.9 })).toBeNull();
    // Listed same-named cities are still read as the largest of the country when no point says otherwise, and the
    // nearest one when it does.
    expect(full.locate({ city: "Springfield", country: "US" })).toEqual(gaz.locate({ city: "Springfield", country: "US" }));
    expect(full.locate({ city: "Springfield", country: "US", lat: 37.2, lon: -93.3 })!.lon).toBeCloseTo(-93.3, 0);
    // A town and a hamlet side by side with one name are one place, so the name is not ambiguous.
    const twin = new Gazetteer(
      [["Roma", "IT", 41.9, 12.5, 100, [], "Lazio"]],
      [["Piccolo", "IT", 41.5, 12.0, "Lazio"], ["Piccolo", "IT", 41.52, 12.02, "Lazio"], ["Grande", "IT", 41.0, 12.0, "Lazio"], ["Grande", "IT", 41.0, 13.0, "Lazio"]],
    );
    expect(twin.locate({ city: "Piccolo", country: "IT" })).toEqual({ name: "Piccolo", lat: 41.5, lon: 12 });
    expect(twin.locate({ city: "Grande", country: "IT" })).toBeNull();
  });

  it("does not take a same-named place in another country for the one the model named", () => {
    // Mahdia is on the list in Tunisia and in Guyana; the model's country decides, with or without a point.
    expect(full.locate({ city: "Mahdia", country: "TN" })!.lon).toBeCloseTo(11.04, 1);
    expect(full.locate({ city: "Mahdia", country: "GY" })!.lon).toBeLessThan(-50);
    // A name only the town list has, in a country the model did not name, is never taken without a point.
    expect(full.locate({ city: "Termoli", country: "TN" })).toBeNull();
    // A territory the list codes under another country is still found, near the model's point or with none.
    expect(full.locate({ city: "Noumea", country: "FR" })).toMatchObject({ name: "Nouméa" });
    expect(full.locate({ city: "Noumea", country: "FR", lat: -22.27, lon: 166.45 })).toMatchObject({ name: "Nouméa" });
    // Natural Earth's few cities with no country code answer to any country.
    expect(full.locate({ city: "Pristina", country: "XK" })).toMatchObject({ name: "Pristina" });
    // A country code no list knows cannot tell places apart: the largest city of the name.
    expect(full.locate({ city: "Paris", country: "ZZ" })!.lon).toBeGreaterThan(0);
  });

  it("places GDELT's own town only where a listed place is close, never in open sea (decision 78)", () => {
    // Not on either list, 5 km from Tabarka: its own point stands.
    expect(full.locate({ city: "Fictional Cove", country: "TN", lat: 36.97, lon: 8.8 }, true)).toEqual({ name: "Fictional Cove", lat: 36.97, lon: 8.8 });
    // A gazetteer point in open sea or deep in the desert, far from any listed place: used to pass within 250 km.
    expect(full.locate({ city: "Fictional Cove", country: "TN", lat: 36.5, lon: 11.5 }, true)).toBeNull();
    expect(full.locate({ city: "Fictional Cove", country: "TN", lat: 31.5, lon: 8.5 }, true)).toBeNull();
    // A listed name still goes to the place nearest the point, wherever that is.
    expect(full.locate({ city: "Tabarka", country: "TN", lat: 36.9, lon: 8.8 }, true)).toEqual({ name: "Tabarka", lat: 36.95, lon: 8.76 });
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
    const towns = full;
    // Rovereto is a GeoNames town, not on the city list: its own name and point.
    expect(towns.locate({ city: "Rovereto", country: "IT", lat: 45.9, lon: 11.03 }, true)).toEqual({ name: "Rovereto", lat: 45.89, lon: 11.04 });
    // A shared name goes to the place nearest GDELT's point, never to a larger namesake elsewhere.
    expect(towns.locate({ city: "Springfield", country: "US", lat: 37.2153, lon: -93.2982 }, true)!.lon).toBeCloseTo(-93.3, 0);
    expect(towns.locate({ city: "Columbus", country: "US", lat: 32.461, lon: -84.9877 }, true)!.lat).toBeCloseTo(32.47, 1);
    // The grouping model's names are placed by the towns too, with the town's own point (see above). Two Roveretos
    // in Italy (44.83, 10.95 and 45.89, 11.04): the model's point picks one, and with none the name is ambiguous.
    expect(towns.locate({ city: "Rovereto", country: "IT", lat: 45.9, lon: 11.03 })).toEqual({ name: "Rovereto", lat: 45.89, lon: 11.04 });
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

  it("counts a region Natural Earth spells two ways once, under its right spelling", () => {
    const spelled = regionSpellings([
      ["DZ", "Béchar"], ["DZ", "BZchar"], ["DZ", "Adrar"], ["AO", "Bié"], ["AO", "BiO"], ["AO", "Bengo"], ["CD", "Équateur"], ["CD", "Cquateur"],
      ["BR", "Goiás"], ["BR", "Goi"], ["BR", "Paraná"], ["BR", "Pará"], ["BR", "Par"], ["CL", "Bío-Bío"], ["CL", "BHo-B"], ["CO", "Boyacá"], ["CO", "Bogota"],
    ]);
    expect(Object.fromEntries(spelled)).toEqual({ "DZ/BZchar": "Béchar", "AO/BiO": "Bié", "CD/Cquateur": "Équateur", "BR/Goi": "Goiás", "BR/Par": "Pará", "CL/BHo-B": "Bío-Bío" });
    const g = Gazetteer.loadWithTowns();
    expect(g.regions()).toContain("DZ/Béchar");
    expect(g.regions()).not.toContain("DZ/BZchar");
    expect(g.regions()).not.toContain("TN/MUdenine");
    expect(g.regions()).not.toContain("BR/Maranh");
  });
});
