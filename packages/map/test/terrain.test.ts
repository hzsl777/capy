// Polygon Kingdom's terrain (decision 63). A coarse grid must never drop a place that has news: an island with
// stories cannot vanish while its neighbours stay.
import { describe, expect, it } from "vitest";
import { buildTerrain, heightAt, type TerrainInput } from "../src/map/terrain.ts";

const base: Omit<TerrainInput, "step" | "anchors" | "isLand"> = {
  isIce: () => false,
  peaks: [],
  grass: [92, 200, 58],
  rock: [165, 138, 106],
  snow: [244, 246, 255],
  snowShade: [185, 196, 224],
};

// Small islands with outlets on the map: Taipei, Colombo, Nicosia, Valletta, Port Louis, Suva.
const ISLANDS: [number, number][] = [
  [121.56, 25.03],
  [79.86, 6.93],
  [33.37, 35.17],
  [14.51, 35.9],
  [57.5, -20.16],
  [178.44, -18.14],
];

function inTriangle(p: [number, number], a: [number, number], b: [number, number], c: [number, number]): boolean {
  const s = (p1: [number, number], p2: [number, number], p3: [number, number]) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

describe("Polygon Kingdom terrain", () => {
  for (const step of [3, 1.5, 0.75]) {
    it(`keeps every place on land with a ${step} degree grid, even where the land test finds none`, () => {
      const t = buildTerrain({ ...base, step, anchors: ISLANDS, isLand: () => false });
      for (const place of ISLANDS) {
        let found = false;
        for (let k = 0; k < t.tris.length && !found; k += 3) {
          const v = [t.tris[k]!, t.tris[k + 1]!, t.tris[k + 2]!].map((i) => [t.lon[i]!, t.lat[i]!] as [number, number]);
          found = inTriangle(place, v[0]!, v[1]!, v[2]!);
        }
        expect(found, `${place} at ${step} degrees`).toBe(true);
      }
    });
  }

  it("keeps the shore at sea level and caps mountains", () => {
    const land = (lon: number, lat: number) => Math.abs(lon) < 20 && Math.abs(lat) < 20;
    const peaks: [number, number][] = [];
    for (let i = 0; i < 400; i++) peaks.push([(i % 20) - 10, Math.floor(i / 20) - 10]);
    const t = buildTerrain({ ...base, step: 1.5, anchors: [], isLand: land, peaks });
    expect(Math.max(...t.h)).toBeLessThanOrEqual(0.67 + 3 * 1.4);
    expect(heightAt(t, 30, 30)).toBe(0);
    expect(heightAt(t, 0, 0)).toBeGreaterThan(0.12);
    // A corner on the coast touches a sea triangle, so the cliffs start at sea level.
    const coastCorner = t.coast[0]!;
    expect(t.h[coastCorner]).toBe(0);
  });

  it("gives the same heights and colours on every build", () => {
    const land = (lon: number, lat: number) => lat > -40 && lat < 60 && Math.sin(lon / 20) > -0.2;
    const a = buildTerrain({ ...base, step: 3, anchors: [], isLand: land, peaks: [[10, 45]] });
    const b = buildTerrain({ ...base, step: 3, anchors: [], isLand: land, peaks: [[10, 45]] });
    expect(Array.from(a.rgb)).toEqual(Array.from(b.rgb));
    expect(Array.from(a.h)).toEqual(Array.from(b.h));
  });
});
