// Find a place: matching, order, what tells same-named places apart, and the names index beside the tiles (decision 78).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { namesOf, placeIdFor, type MapPlace } from "@2dayai/core";
import { coordsLabel, entriesFromFile, entriesFromNames, fold, MAX_RESULTS, namesUrl, placeIdOf, rank, reportsLabel, searchPlaces, tellApart, type PlaceEntry } from "../src/search.ts";
import type { MapFile, MapItem, MapNames, MapTile } from "../src/types.ts";

const entry = (name: string, over: Partial<PlaceEntry> = {}): PlaceEntry => ({ id: `ll:${name}`, name, key: fold(name), lat: 0, lon: 0, reports: 1, tier: 4, ...over });
const names = (r: { shown: PlaceEntry[] }) => r.shown.map((e) => e.name);

describe("matching ignores case, accents and punctuation", () => {
  it("folds a name the way a reader types it", () => {
    expect(fold("São Paulo")).toBe("sao paulo");
    expect(fold("SAO  PAULO ")).toBe("sao paulo");
    expect(fold("Tromsø")).toBe("tromso");
    expect(fold("Łódź")).toBe("lodz");
    expect(fold("İstanbul")).toBe("istanbul");
    expect(fold("Zürich")).toBe("zurich");
    expect(fold("O'Fallon")).toBe("ofallon");
    expect(fold("O’Fallon")).toBe("ofallon");
    expect(fold("Saint-Denis")).toBe("saint denis");
    expect(fold("St. Louis")).toBe("st louis");
    expect(fold("Straße")).toBe("strasse");
    // Another script stays itself, so its names match themselves.
    expect(fold("東京")).toBe("東京");
    expect(fold("Москва")).toBe("москва");
  });

  it('finds São Paulo from "sao paulo", "SAO" and "são"', () => {
    const all = [entry("São Paulo"), entry("Santos"), entry("Sacramento")];
    for (const q of ["sao paulo", "SAO", "são", "Sao Paulo"]) expect(names(searchPlaces(all, q))[0], q).toBe("São Paulo");
    expect(names(searchPlaces(all, "Sao"))).toEqual(["São Paulo"]);
  });

  it("matches nothing for an empty or all-punctuation query", () => {
    expect(searchPlaces([entry("Lima")], "")).toEqual({ shown: [], more: 0 });
    expect(searchPlaces([entry("Lima")], "  ...  ")).toEqual({ shown: [], more: 0 });
  });
});

describe("results are ordered by how well the name matches, then by name, and by nothing about the news", () => {
  it("ranks exact, then starts with, then contains", () => {
    expect(rank("york", "york")).toBe(0);
    expect(rank("york city", "york")).toBe(1);
    expect(rank("new york", "york")).toBe(2);
    expect(rank("lima", "york")).toBe(3);
    const all = [entry("New York"), entry("Yorkshire"), entry("York"), entry("Port York"), entry("York Beach")];
    expect(names(searchPlaces(all, "york"))).toEqual(["York", "York Beach", "Yorkshire", "New York", "Port York"]);
  });

  it("orders alphabetically within a rank, folded, so accents do not push a name to the end", () => {
    const all = [entry("Zagreb"), entry("Álamo"), entry("Alma"), entry("Alba"), entry("Almaty")];
    expect(names(searchPlaces(all, "al"))).toEqual(["Álamo", "Alba", "Alma", "Almaty"]);
  });

  it("never puts a place first for its report count, its zoom tier or its position in the data", () => {
    // The place with the most reports and the highest importance is last alphabetically, so it is last.
    const all = [entry("Brandon", { reports: 1, tier: 4 }), entry("Brasov", { reports: 9, tier: 0 }), entry("Bratislava", { reports: 400, tier: 0 }), entry("Braga", { reports: 2, tier: 3 })];
    expect(names(searchPlaces(all, "bra"))).toEqual(["Braga", "Brandon", "Brasov", "Bratislava"]);
    // The same in any order the data comes in.
    expect(names(searchPlaces([...all].reverse(), "bra"))).toEqual(["Braga", "Brandon", "Brasov", "Bratislava"]);
    expect(names(searchPlaces([all[2]!, all[0]!, all[3]!, all[1]!], "bra"))).toEqual(["Braga", "Brandon", "Brasov", "Bratislava"]);
  });

  it("keeps places of one name apart in a fixed order, by latitude and then longitude", () => {
    const a = entry("Springfield", { id: "ll:a", lat: 44.05, lon: -123.02, reports: 9 });
    const b = entry("Springfield", { id: "ll:b", lat: 39.8, lon: -89.64, reports: 1 });
    const c = entry("Springfield", { id: "ll:c", lat: 39.8, lon: -72.6, reports: 5 });
    for (const order of [[a, b, c], [c, b, a], [b, a, c]]) expect(searchPlaces(order, "springfield").shown.map((e) => e.id)).toEqual(["ll:b", "ll:c", "ll:a"]);
  });

  it(`shows at most ${MAX_RESULTS} and says how many more match`, () => {
    const all = Array.from({ length: 20 }, (_, i) => entry(`Town ${String.fromCharCode(97 + i)}`));
    const r = searchPlaces(all, "town");
    expect(r.shown).toHaveLength(8);
    expect(r.more).toBe(12);
    expect(names(r)).toEqual(all.slice(0, 8).map((e) => e.name));
    expect(searchPlaces(all, "town", 3).shown).toHaveLength(3);
  });

  it("leaves out a match it is told to skip, before counting", () => {
    const all = [entry("Alpha"), entry("Alpine"), entry("Alps")];
    const r = searchPlaces(all, "al", 2, (e) => e.name === "Alpha");
    expect(names(r)).toEqual(["Alpine", "Alps"]);
    expect(r.more).toBe(0);
  });
});

describe("what tells same-named results apart (rule 2: never a country or region)", () => {
  it("shows coordinates only for names that share the list, and no more than the count for the rest", () => {
    const list = [entry("Lima", { lat: -12.05, lon: -77.04 }), entry("Springfield", { lat: 39.8, lon: -89.64 }), entry("Springfield", { lat: 44.05, lon: -123.02 })];
    expect(tellApart(list)).toEqual([null, "39.80 N, 89.64 W", "44.05 N, 123.02 W"]);
    expect(coordsLabel(-12.05, 77.04)).toBe("12.05 S, 77.04 E");
    expect(reportsLabel(1)).toBe("1 report");
    expect(reportsLabel(3)).toBe("3 reports");
  });

  it("treats names that fold the same as the same name", () => {
    expect(tellApart([entry("Sao Paulo"), entry("São Paulo", { lat: 5 })]).every((x) => x !== null)).toBe(true);
  });
});

describe("the day's places", () => {
  const place = (name: string, i: number): MapPlace => ({ id: `ll:${i}.00,0.00`, name, lat: i, lon: 0 });
  const item = (id: string, at: number, over: Partial<MapItem> = {}): MapItem => ({ id, t: 1, title: id, url: `https://a.example/${id}`, domain: "a.example", publisher: "A", lang: "en", topics: [], place: at, ...over });
  const file = (items: MapItem[]): MapFile => ({ version: 2, source: "live", generatedAt: 2, runDate: "2026-09-30", places: [place("Lima", 1), place("Quito", 2), place("Bogota", 3)], items, events: {}, telegram: null });

  it("counts a place's reports over the whole day and finds the zoom tier it shows at", () => {
    const f = file([item("a", 0, { importance: 4, reach: 1 }), item("b", 0, { importance: 1 }), item("c", 1, { importance: 2, reach: 1 }), item("d", 1, { via: "gdelt" })]);
    expect(entriesFromFile(f, true).map((e) => [e.name, e.reports, e.tier, e.index])).toEqual([
      ["Lima", 2, 0, 0],
      ["Quito", 2, 2, 1],
    ]);
  });

  it("leaves out a place with no report, and puts every place at tier 0 when the file has no tiers", () => {
    const f = file([item("a", 2)]);
    expect(entriesFromFile(f, false).map((e) => [e.name, e.tier])).toEqual([["Bogota", 0]]);
  });

  it("is searchable by the names the file has", () => {
    const f = file([item("a", 0), item("b", 1)]);
    expect(names(searchPlaces(entriesFromFile(f, false), "qui"))).toEqual(["Quito"]);
    expect(names(searchPlaces(entriesFromFile(f, false), "bogota"))).toEqual([]);
  });
});

describe("the names index", () => {
  it("makes entries for the towns of tiles not loaded, at the closest zoom, with the ids the tiles use", () => {
    const index: MapNames = { version: 2, runDate: "2026-09-30", places: [["Malindi", -3.21, 40.1, 1], ["Kisumu", -0.09, 34.75, 2]] };
    const out = entriesFromNames(index);
    expect(out.map((e) => [e.name, e.id, e.reports, e.tier, e.index])).toEqual([
      ["Malindi", "ll:-3.21,40.10", 1, 4, undefined],
      ["Kisumu", "ll:-0.09,34.75", 2, 4, undefined],
    ]);
    expect(names(searchPlaces(out, "mal"))).toEqual(["Malindi"]);
  });

  it("skips a row that is not a name and a point, and a file of another version, instead of failing", () => {
    const bad = { version: 2, runDate: "x", places: [["", 1, 1, 1], [3, 1, 1, 1], ["NoLat", Number.NaN, 1, 1], ["Far", 91, 0, 1], ["Wide", 0, 181, 1], null, "text", ["Fine", 1, 2, 3]] } as unknown as MapNames;
    expect(entriesFromNames(bad).map((e) => e.name)).toEqual(["Fine"]);
    expect(entriesFromNames({ version: 1 } as unknown as MapNames)).toEqual([]);
    expect(entriesFromNames(null as unknown as MapNames)).toEqual([]);
  });

  it("is fetched from the day's tile folder, and only when the file says it exists", () => {
    const local = { deg: 10, base: "local/2026-09-30/", tiles: { "0N_0E": 1 }, names: true as const };
    expect(namesUrl("/", local)).toBe("/data/local/2026-09-30/names.json");
    expect(namesUrl("/", { ...local, names: undefined })).toBeNull();
    expect(namesUrl("/", undefined)).toBeNull();
    expect(namesUrl("/", { ...local, base: "../secret/" })).toBeNull();
  });

  it("makes a place's id the way the pipeline does", () => {
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 2000; i++) {
      const [lat, lon] = [rand() * 180 - 90, rand() * 360 - 180];
      expect(placeIdOf(lat, lon)).toBe(placeIdFor(lat, lon));
    }
  });
});

describe("the sample's names index", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
  const main = JSON.parse(readFileSync(join(dir, "sample.json"), "utf8")) as MapFile;
  const base = join(dir, main.local!.base);
  const index = JSON.parse(readFileSync(join(base, "names.json"), "utf8")) as MapNames;
  const tiles = readdirSync(base)
    .filter((f) => /^\d/.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(base, f), "utf8")) as MapTile);

  it("is listed in the day's file and written beside the tiles", () => {
    expect(main.local?.names).toBe(true);
    expect(namesUrl("/", main.local)).toBe("/data/local/sample/names.json");
    expect(index.version).toBe(2);
    expect(index.runDate).toBe(main.runDate);
  });

  it("lists every town of every tile once, with the count of its stories, as the export writes it", () => {
    const found = tiles.flatMap((t) => t.places.map((p, i) => [p, t.items.filter((it) => it[6] === i).length] as const));
    expect(index).toEqual(namesOf(main.runDate, found));
    expect(index.places).toHaveLength(found.length);
    expect(index.places.reduce((n, r) => n + r[3], 0)).toBe(tiles.reduce((n, t) => n + t.items.length, 0));
  });

  it("is small: a few bytes a town", () => {
    const bytes = Buffer.byteLength(JSON.stringify(index));
    expect(bytes / index.places.length).toBeLessThan(40);
  });

  it("finds the sample's towns, in tiles not loaded and in the day's file", () => {
    const all = [...entriesFromFile(main, true), ...entriesFromNames(index)];
    expect(names(searchPlaces(all, "valparaiso"))).toEqual(["Valparaíso"]);
    expect(names(searchPlaces(all, "tromso"))).toEqual(["Tromsø"]);
    expect(names(searchPlaces(all, "malindi"))).toEqual(["Malindi"]);
    expect(names(searchPlaces(all, "nairobi"))).toEqual(["Nairobi"]);
    // A town with no report today cannot be found.
    expect(names(searchPlaces(all, "sao paulo"))).toEqual([]);
  });

  it("holds no country or region name for any place", () => {
    expect(JSON.stringify(index)).not.toMatch(/country|region|kenya|morocco|chile|norway/i);
    for (const row of index.places) expect(row).toHaveLength(4);
  });
});
