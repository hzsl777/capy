// Rose Window's glass pieces (decision 70). Every point of the world is in a piece, and every point of land is in a
// piece that has a land colour, so no island shows as sea glass.
import { describe, expect, it } from "vitest";
import { buildPieces } from "../src/map/glass.ts";

// Small round islands a degree or so across, two by the 180th meridian, and one block the size of a continent.
const ISLANDS: [number, number, number][] = [
  [14.4, 35.9, 0.5],
  [57.5, -20.2, 0.5],
  [179.8, -17.5, 0.6],
  [-179.9, 51.9, 0.5],
  [-25.1, 38.7, 0.4],
];
const isLand = (lon: number, lat: number) =>
  (lon > 10 && lon < 40 && lat > -30 && lat < 30) ||
  ISLANDS.some(([x, y, r]) => Math.hypot(((((lon - x) % 360) + 540) % 360) - 180, lat - y) < r);

function inPolygon(x: number, y: number, xs: number[], ys: number[]): boolean {
  let inside = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    if (ys[i]! > y !== ys[j]! > y && x < ((xs[j]! - xs[i]!) * (y - ys[i]!)) / (ys[j]! - ys[i]!) + xs[i]!) inside = !inside;
  }
  return inside;
}

function piecesAt(p: ReturnType<typeof buildPieces>, lon: number, lat: number): number[] {
  const found: number[] = [];
  for (let k = 0; k < p.start.length; k++) {
    const s = p.start[k]!, c = p.count[k]!;
    const xs = Array.from(p.lon.subarray(s, s + c)), ys = Array.from(p.lat.subarray(s, s + c));
    for (const shift of [-360, 0, 360]) if (inPolygon(lon + shift, lat, xs, ys)) found.push(k);
  }
  return found;
}

describe("Rose Window glass", () => {
  for (const step of [8, 4]) {
    const p = buildPieces(step, isLand, () => false, [], []);

    it(`cuts every piece as a polygon at ${step} degrees`, () => {
      for (let k = 0; k < p.start.length; k++) expect(p.count[k]!).toBeGreaterThanOrEqual(3);
    });

    it(`leaves no gap in the world at ${step} degrees`, () => {
      for (let lat = -85; lat <= 85; lat += 17.3)
        for (let lon = -179; lon < 180; lon += 23.7) expect(piecesAt(p, lon, lat).length, `${lon},${lat}`).toBeGreaterThan(0);
    });

    it(`gives land glass to every piece with land in it, small islands too, at ${step} degrees`, () => {
      for (const [x, y] of ISLANDS) {
        const ks = piecesAt(p, x, y);
        expect(ks.length, `${x},${y}`).toBeGreaterThan(0);
        for (const k of ks) expect(p.land[k], `${x},${y}`).not.toBe("");
      }
    });
  }
});
