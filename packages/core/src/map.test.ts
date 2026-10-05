import { describe, expect, it } from "vitest";
import { localIndex, namesOf, placeIdFor, splitLocal, type MapFile, type MapItem, type MapPlace } from "./map.js";

const lima: MapPlace = { id: "ll:-12.05,-77.04", name: "Lima", lat: -12.05, lon: -77.04 };
const item = (id: string, place: number, over: Partial<MapItem> = {}): MapItem => ({ id, t: 1_790_000_000, title: id, url: `https://a.example/${id}`, domain: "a.example", publisher: "A", lang: "en", topics: [], place, ...over });
const local = (id: string, place: number): MapItem => item(id, place, { via: "gdelt", reach: 1, importance: 1 });
const day = (places: MapPlace[], items: MapItem[]): MapFile => ({ version: 2, source: "live", generatedAt: 1_790_000_000, runDate: "2026-09-29", places, items, events: {}, telegram: null });

describe("the names index beside the tiles (decision 78)", () => {
  it("lists every place a local story is at, once, with its story count and coordinates to two decimals", () => {
    const towns: MapPlace[] = [lima, { id: "ll:40.71,-74.01", name: "Springfield", lat: 40.7123, lon: -74.0099 }, { id: "ll:39.80,-89.64", name: "Springfield", lat: 39.8, lon: -89.64 }];
    const { names, main } = splitLocal(day(towns, [item("o1", 0), local("g1", 1), local("g2", 1), local("g3", 2)]), "local/2026-09-29/");
    expect(names).toEqual({
      version: 2,
      runDate: "2026-09-29",
      places: [
        // Same name: kept apart, ordered by latitude (never by how many stories).
        ["Springfield", 39.8, -89.64, 1],
        ["Springfield", 40.71, -74.01, 2],
      ],
    });
    expect(main.local).toEqual({ deg: 10, base: "local/2026-09-29/", tiles: { "30N_90W": 1, "40N_80W": 2 }, names: true });
  });

  it("writes the ids' own rounding, so a row's id is placeIdFor of its latitude and longitude", () => {
    const p: MapPlace = { id: placeIdFor(39.9996, -0.0004), name: "Edge", lat: 39.9996, lon: -0.0004 };
    const { names } = splitLocal(day([lima, p], [item("o1", 0), local("g1", 1)]), "local/x/");
    const [, lat, lon] = names!.places[0]!;
    expect(placeIdFor(lat, lon)).toBe(p.id.replace("-0.00", "0.00"));
  });

  it("joins a place that two tiles list, and has no names index without local stories", () => {
    const a: MapPlace = { id: "ll:5.00,5.00", name: "Same", lat: 5, lon: 5 };
    expect(namesOf("2026-09-29", [[a, 2], [a, 3]]).places).toEqual([["Same", 5, 5, 5]]);
    const none = splitLocal(day([lima], [item("o1", 0)]), "local/x/");
    expect(none.names).toBeNull();
    expect(none.main.local).toEqual({ deg: 10, base: "local/x/", tiles: {} });
    expect(localIndex(10, "local/x/", {})).not.toHaveProperty("names");
  });

  it("sorts by name, then latitude and longitude, so one day always writes one file", () => {
    const at = (name: string, lat: number, lon: number): [MapPlace, number] => [{ id: placeIdFor(lat, lon), name, lat, lon }, 1];
    const rows = namesOf("2026-09-29", [at("b", 1, 1), at("a", 9, 9), at("a", 2, 7), at("a", 2, 3)]).places.map((r) => r.slice(0, 3).join(","));
    expect(rows).toEqual(["a,2,3", "a,2,7", "a,9,9", "b,1,1"]);
  });
});
