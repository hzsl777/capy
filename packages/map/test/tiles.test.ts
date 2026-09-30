import { describe, expect, it } from "vitest";
import { LOCAL_TILE_DEG, tileBounds, tileKey } from "@2dayai/core";
import { groupByPlace, FILTERS, mergeTiles, tierOf, tileCell, tileKeyOf, tileUrl } from "../src/data.ts";
import type { MapFile, MapTile } from "../src/types.ts";

describe("tiles of local stories (decision 78)", () => {
  it("names a point's tile the way the pipeline does", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const points: [number, number][] = [[0, 0], [-0.001, -0.001], [90, 180], [-90, -180], [89.99, 179.99], [40, -80], [39.999, -80.001], [-10, 30]];
    for (let i = 0; i < 2000; i++) points.push([rand() * 180 - 90, rand() * 360 - 180]);
    for (const [lat, lon] of points) {
      const key = tileKeyOf(lat, lon, LOCAL_TILE_DEG);
      expect(key).toBe(tileKey(lat, lon));
      expect(tileCell(key, LOCAL_TILE_DEG)).toEqual(tileBounds(key));
      const cell = tileCell(key, LOCAL_TILE_DEG)!;
      expect(lat >= cell.south - 1e-9 && lat <= cell.north && lon >= cell.west - 1e-9 && lon <= cell.east).toBe(true);
    }
    expect(tileKeyOf(45, -75, 10)).toBe("40N_80W");
    expect(tileKeyOf(-5, 35, 10)).toBe("10S_30E");
  });

  it("builds a tile's address only from a folder the site uses", () => {
    const index = { deg: 10, base: "local/2026-09-30/", tiles: { "40N_80W": 3 } };
    expect(tileUrl("/", index, "40N_80W")).toBe("/data/local/2026-09-30/40N_80W.json");
    expect(tileUrl("/", { ...index, base: "../secret/" }, "40N_80W")).toBeNull();
    expect(tileUrl("/", index, "../x")).toBeNull();
  });

  it("adds a tile's places and stories to the day, keeping every index the page already holds", () => {
    const file: MapFile = {
      version: 2,
      source: "live",
      generatedAt: 1000,
      runDate: "2026-09-30",
      places: [{ id: "ll:1.00,1.00", name: "Outlet city", lat: 1, lon: 1 }],
      items: [{ id: "a1", t: 900, title: "An outlet story", url: "https://o.example/1", domain: "o.example", publisher: "Outlet", lang: "en", topics: ["politics"], place: 0, importance: 3, reach: 1 }],
      events: {},
      telegram: null,
      local: { deg: 10, base: "local/2026-09-30/", tiles: { "0N_0E": 3 } },
    };
    const ids = new Map([["ll:1.00,1.00", 0]]);
    const tile: MapTile = {
      version: 2,
      runDate: "2026-09-30",
      key: "0N_0E",
      places: [
        { id: "ll:2.00,2.00", name: "Town A", lat: 2, lon: 2 },
        { id: "ll:1.00,1.00", name: "Outlet city", lat: 1, lon: 1 },
      ],
      items: [
        ["g1", 950, "Town A council meets", "https://a.example/1", "a.example", "fr", 0],
        ["g2", 940, "A story at the same point as the outlet's", "https://b.example/2", "b.example", "en", 1],
        ["g3", 930, "Town A market reopens", "https://a.example/3", "a.example", "fr", 0],
      ],
    };
    expect(mergeTiles(file, ids, [tile])).toBe(3);
    expect(file.places.map((p) => p.name)).toEqual(["Outlet city", "Town A"]);
    expect(file.items[0]!.place).toBe(0);
    const added = file.items.filter((i) => i.via === "gdelt");
    expect(added.map((i) => [i.id, i.place])).toEqual([["g1", 1], ["g2", 0], ["g3", 1]]);
    expect(added.every((i) => i.publisher === i.domain && i.importance === 1 && i.reach === 1 && i.topics.length === 0 && tierOf(i, true) === 4)).toBe(true);
    // A tile loaded twice adds nothing.
    expect(mergeTiles(file, ids, [tile])).toBe(0);
    const byPlace = groupByPlace(file, { topics: new Set(FILTERS), from: 0, to: 1000 });
    expect(byPlace.get(1)!.map((i) => i.id)).toEqual(["g1", "g3"]);
    expect(byPlace.get(0)!.map((i) => i.id)).toEqual(["g2", "a1"]);
  });
});
