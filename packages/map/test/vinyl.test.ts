// Record Player (src/map/vinyl.ts): the world as a record round the North Pole, read by a needle fixed on the frame's
// centre. The needle's place is always under it, the map is seen from above and never mirrored, a drag keeps the point
// under the finger, the centre label covers no place at any zoom, Antarctica is filled as land and not turned inside
// out, the tonearm stays in the frame with its stylus on the centre, and the sheen can never flash.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { geoArea, geoPath } from "d3-geo";
import type { FeatureCollection } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";
import {
  armOf,
  CAP,
  colatOf,
  dragRecord,
  EDGE_R,
  NEEDLE_LAT,
  polarRing,
  polarSafe,
  radiusOf,
  recordProjection,
  recordScale,
  SHEEN_MAX,
  sleeveOf,
  spindleY,
} from "../src/map/vinyl.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";
import { samplePlaces } from "./sample.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const W = 1000;
const H = 700;
const BASE = Math.min(W, H) * (THEMES.vinyl.globeScale ?? 0.46);
const EXTENT: [[number, number], [number, number]] = [
  [-48, -48],
  [W + 48, H + 48],
];
const record = (lon: number, lat: number, zoom = 1) => recordProjection(lon, lat, BASE, zoom, W, H, EXTENT);

/** Places spread over the whole sphere, the poles' neighbourhoods and the antimeridian included. */
const SPOTS: [number, number][] = [];
for (let lat = -84; lat <= 82; lat += 9.5) for (let lon = -179; lon < 180; lon += 17) SPOTS.push([lon, lat]);
SPOTS.push([36.82, -1.29], [151.2, -33.87], [-70.6, -33.45], [-62.5, 82.48], [15.6, 78.2], [180, 0], [-180, 10]);

/** Every fixed city the grouping model can place a story at, and every place of the sample day. */
function allPlaces(): { lat: number; lon: number }[] {
  const listed = JSON.parse(readFileSync(here("../../pipeline/data/places.json"), "utf8")) as [string, string, number, number][];
  return [...listed.map(([, , lat, lon]) => ({ lat, lon })), ...samplePlaces()];
}

describe("Record Player", () => {
  it("is experimental, so it opens only from a link and stays off the Design menu", () => {
    expect(THEMES.vinyl.experimental).toBe(true);
    expect(DESIGN_GROUPS.flatMap((g) => g.ids)).not.toContain("vinyl");
    expect(FEATURED).not.toContain("vinyl");
    expect(THEMES.vinyl.fresh).not.toBe(THEMES.vinyl.dot);
  });

  it("puts the needle's place exactly on the frame's centre, with the spindle straight above it", () => {
    for (const [lon, lat] of SPOTS) {
      const la = Math.max(NEEDLE_LAT[0], Math.min(NEEDLE_LAT[1], lat));
      for (const zoom of [1, 2.5, 9]) {
        const p = record(lon, la, zoom)([lon, la])!;
        expect(p[0]).toBeCloseTo(W / 2, 6);
        expect(p[1]).toBeCloseTo(H / 2, 6);
        const t = record(lon, la, zoom).translate();
        expect(t[0]).toBeCloseTo(W / 2, 9);
        expect(t[1]).toBeCloseTo(spindleY(H, la, recordScale(BASE, zoom)), 6);
        expect(t[1]).toBeLessThan(H / 2);
      }
    }
  });

  it("is seen from above the North Pole and never mirrored: east of the needle is to its right, north toward the spindle", () => {
    for (const [lon, lat] of [
      [0, 20],
      [36.8, -1.3],
      [-120, 50],
      [150, -35],
    ] as const) {
      const proj = record(lon, lat);
      const east = proj([lon + 1, lat])!;
      const north = proj([lon, lat + 1])!;
      expect(east[0]).toBeGreaterThan(W / 2);
      expect(north[1]).toBeLessThan(H / 2);
      // The parallels are circles round the spindle: every point of one is the same distance from it.
      const [sx, sy] = proj.translate();
      const d = (q: [number, number]) => Math.hypot(q[0] - sx, q[1] - sy);
      expect(d(proj([lon + 90, lat])!)).toBeCloseTo(d(proj([lon - 135, lat])!), 6);
    }
  });

  it("takes points back through its inverse", () => {
    const proj = record(20, 30, 1.7);
    for (const [lon, lat] of SPOTS) {
      if (lat < -89 || 90 - lat <= CAP) continue;
      const back = proj.invert!(proj([lon, lat])!)!;
      expect(Math.cos(((back[0] - lon) * Math.PI) / 180)).toBeCloseTo(1, 6);
      expect(back[1]).toBeCloseTo(lat, 6);
    }
    for (const c of [0.05, 0.4, 1.2, 2.5, 3.1]) expect(colatOf(radiusOf(c))).toBeCloseTo(c, 9);
  });

  it("keeps the point under the finger as the record is dragged, and only turns it when dragged round the spindle", () => {
    let checked = 0;
    for (const [lon, lat] of [
      [10, 30],
      [36.8, -1.3],
      [-75, 45],
      [120, -20],
    ] as const) {
      for (const zoom of [1, 3]) {
        const s = recordScale(BASE, zoom);
        const proj = record(lon, lat, zoom);
        for (const [fx, fy, dx, dy] of [
          [W / 2, H / 2, 30, 0],
          [W / 2 + 60, H / 2 + 40, -25, 18],
          [W / 2 - 80, H / 2 - 50, 10, 35],
          [W / 2 + 15, H / 2 - 20, 0, -30],
        ] as const) {
          const grabbed = proj.invert!([fx, fy])!;
          const [nlon, nlat] = dragRecord(lon, lat, s, W, H, [fx, fy], [fx + dx, fy + dy]);
          if (nlat <= NEEDLE_LAT[0] || nlat >= NEEDLE_LAT[1]) continue;
          const q = record(nlon, nlat, zoom)(grabbed)!;
          expect(Math.hypot(q[0] - fx - dx, q[1] - fy - dy), `${lon},${lat} z${zoom} from ${fx},${fy}`).toBeLessThan(0.05);
          checked++;
        }
        // Round the spindle at the needle's own distance: the latitude holds and only the longitude moves.
        const sy = spindleY(H, lat, s);
        const r = H / 2 - sy;
        const a = 0.3;
        const [tlon, tlat] = dragRecord(lon, lat, s, W, H, [W / 2, H / 2], [W / 2 + r * Math.sin(a), sy + r * Math.cos(a)]);
        expect(tlat).toBeCloseTo(lat, 6);
        expect(Math.abs(((tlon - lon + 540) % 360) - 180)).toBeGreaterThan(5);
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("keeps the needle between the centre label and the record's edge", () => {
    const s = recordScale(BASE, 1);
    const [lon, lat] = dragRecord(0, 60, s, W, H, [W / 2, H / 2], [W / 2, H]);
    expect(lat).toBeLessThanOrEqual(NEEDLE_LAT[1]);
    expect(Number.isFinite(lon)).toBe(true);
    expect(NEEDLE_LAT[1]).toBeLessThan(90 - CAP);
  });

  it("covers no place with the centre label, at any zoom", () => {
    const places = allPlaces();
    expect(places.length).toBeGreaterThan(1000);
    const north = Math.max(...places.map((p) => p.lat));
    expect(90 - north).toBeGreaterThan(CAP + 0.5);
    // On screen too: every place's point lies outside the label's edge. Markers are drawn over the label in any case.
    for (const zoom of [1, 4, 14]) {
      const s = recordScale(BASE, zoom);
      const gap = s * (radiusOf((90 - north) / (180 / Math.PI)) - radiusOf(CAP / (180 / Math.PI)));
      expect(gap, `zoom ${zoom}`).toBeGreaterThan(zoom === 1 ? 0.5 : 2);
    }
    // The tuning reaches the northernmost place: the needle can go past it.
    expect(NEEDLE_LAT[1]).toBeGreaterThan(north);
  });

  it("fills Antarctica as land between its coast and the record's edge, never the record inside it", () => {
    const topo = JSON.parse(readFileSync(here("../public/basemap/world-110m.json"), "utf8")) as Topology;
    const land = polarSafe(feature(topo, topo.objects.land as GeometryCollection) as never) as unknown as FeatureCollection;
    const proj = record(30, 10);
    const disc = Math.PI * (recordScale(BASE, 1) * EDGE_R) ** 2;
    const path = geoPath(proj);
    let polar = 0;
    for (const f of land.features) {
      const g = f.geometry;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      for (const poly of polys) {
        if (!poly[0]!.some((p) => p[1]! < -85)) continue;
        polar++;
        const area = path.area({ type: "Polygon", coordinates: poly });
        expect(area).toBeGreaterThan(0);
        expect(area).toBeLessThan(disc * 0.4);
        // Still the same land on the sphere: moving the edge off the pole changes its area by very little.
        expect(geoArea({ type: "Polygon", coordinates: poly })).toBeLessThan(0.2 * 4 * Math.PI);
      }
    }
    expect(polar).toBeGreaterThan(0);
    expect(polarRing([[0, -80], [180, -80], [180, -90], [-180, -90], [-180, -80], [0, -80]]).every((p) => p[1]! > -90)).toBe(true);
  });

  it("keeps the tonearm inside the frame with its stylus on the centre", () => {
    for (const [w, h] of [
      [1000, 645],
      [1400, 900],
      [390, 470],
      [360, 300],
      [390, 150],
      [1920, 1000],
    ] as const) {
      const a = armOf(w, h);
      expect(a.nx).toBe(w / 2);
      expect(a.ny).toBe(h / 2);
      // The pivot's base and the counterweight behind it.
      const reach = a.base * 2.15;
      const back = [a.px + (reach * (a.px - a.nx)) / a.L, a.py + (reach * (a.py - a.ny)) / a.L];
      for (const [x, y] of [[a.px, a.py], back] as const) {
        expect(x, `${w}x${h}`).toBeLessThanOrEqual(w);
        expect(y, `${w}x${h}`).toBeGreaterThanOrEqual(0);
      }
      expect(armOf(w, h)).toEqual(a);
    }
  });

  it("lays the sleeve inside the frame, with room for the record beside it only on a wide screen", () => {
    for (const [w, h] of [
      [1000, 645],
      [390, 470],
    ] as const) {
      const b = sleeveOf(w, h);
      expect(b.x0).toBeGreaterThan(0);
      expect(b.x1).toBeLessThan(w);
      expect(b.y0).toBeGreaterThan(0);
      expect(b.y1).toBeLessThan(h);
      expect(b.x0 >= 56).toBe(w >= 700);
    }
  });

  it("never flashes: the sheen, the only light that moves, stays under a tenth of full brightness", () => {
    expect(SHEEN_MAX).toBeLessThan(0.1);
  });
});
