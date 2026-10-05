// Record Player (src/map/vinyl.ts): the deck is fixed to the screen and the world is a record that turns on it, round the
// North Pole at the spindle, read by a needle on the tonearm. The needle's place is always under it, the arm's reach
// covers every latitude, the picture that is rotated is the one the markers are placed on, the map is seen from above
// and never mirrored, a drag turns the record with the finger, the centre label covers no place at any zoom, Antarctica is
// filled as land and not turned inside out, the tonearm and platter stay in the frame, and nothing flashes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { geoArea, geoContains, geoPath } from "d3-geo";
import type { FeatureCollection } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";
import {
  BRAKE_DEG,
  CAM_ZOOM,
  CAP,
  colatOf,
  deckOf,
  dragRecord,
  EDGE_R,
  LABEL_R,
  needleAt,
  needleOffset,
  NEEDLE_LAT,
  pivotAt,
  polarRing,
  polarSafe,
  radiusOf,
  recordProjection,
  recordScale,
  restProjection,
  SHEEN_MAX,
  SPIN_DEG,
  sleeveOf,
  turnOf,
  turnToNeedle,
  viewOf,
} from "../src/map/vinyl.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";
import { samplePlaces } from "./sample.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const DEG = 180 / Math.PI;
const W = 1000;
const H = 700;
const record = (lon: number, lat: number, zoom = 1, w = W, h = H) =>
  recordProjection(lon, lat, zoom, w, h, [
    [-48, -48],
    [w + 48, h + 48],
  ]);
const FRAMES: [number, number][] = [
  [1000, 645],
  [1000, 700],
  [1400, 900],
  [1920, 1000],
  [390, 470],
  [390, 844],
  [360, 300],
  [390, 150],
  [700, 520],
];

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
  it("is in the Design menu, in one group and not featured (decision 134)", () => {
    const t = THEMES.vinyl;
    expect(t.experimental).toBeFalsy();
    expect(DESIGN_GROUPS.filter((g) => g.ids.includes("vinyl"))).toHaveLength(1);
    expect(FEATURED).not.toContain("vinyl");
    expect(t.fresh).not.toBe(t.dot);
  });

  it("lays the turntable out inside every frame: the platter whole, the arm's pivot, base and counterweight clear of the edges", () => {
    for (const [w, h] of FRAMES) {
      const d = deckOf(w, h);
      expect(deckOf(w, h)).toBe(d);
      expect(d.cx).toBe(w / 2);
      expect(d.cy).toBe(h / 2);
      expect(d.R).toBeLessThan(d.Rp);
      // The platter, with its rim, is in the frame and leaves room for the slab round it (when the frame is not tiny).
      if (Math.min(w, h) >= 300) {
        expect(d.cx - d.Rp, `${w}x${h}`).toBeGreaterThanOrEqual(0);
        expect(d.cx + d.Rp, `${w}x${h}`).toBeLessThanOrEqual(w);
        expect(d.cy - d.Rp, `${w}x${h}`).toBeGreaterThanOrEqual(0);
        expect(d.cy + d.Rp, `${w}x${h}`).toBeLessThanOrEqual(h);
        const { px, py } = pivotAt(d, 20);
        const reach = d.base * 2.15;
        const ex = Math.cos(d.alpha);
        const ey = Math.sin(d.alpha);
        // The pivot's base, and the counterweight behind it, away from the record.
        for (const [x, y] of [
          [px, py],
          [px + ex * reach, py + ey * reach],
        ] as const) {
          expect(x, `${w}x${h}`).toBeGreaterThan(0);
          expect(x, `${w}x${h}`).toBeLessThan(w);
          expect(y, `${w}x${h}`).toBeGreaterThan(0);
          expect(y, `${w}x${h}`).toBeLessThan(h);
        }
      }
    }
  });

  it("reaches every latitude: the arm's needle is as far from the spindle as the groove, and as far from the pivot as the arm is long", () => {
    for (const [w, h] of FRAMES) {
      const d = deckOf(w, h);
      for (let lat = NEEDLE_LAT[0]; lat <= NEEDLE_LAT[1] + 1e-9; lat += 7.3) {
        const [ux, uy] = needleOffset(d, lat);
        const want = (d.R / EDGE_R) * radiusOf((90 - lat) / DEG);
        expect(Math.hypot(ux, uy), `${w}x${h} lat ${lat}`).toBeCloseTo(want, 6);
        const px = d.D * Math.cos(d.alpha);
        const py = d.D * Math.sin(d.alpha);
        expect(Math.hypot(ux - px, uy - py), `${w}x${h} lat ${lat}`).toBeCloseTo(d.L, 6);
      }
      // The needle is over the record's edge at the South Pole and short of the label at the other end.
      const south = needleOffset(d, NEEDLE_LAT[0]);
      expect(Math.hypot(south[0], south[1])).toBeGreaterThan(d.R * 0.999);
      expect(Math.hypot(south[0], south[1])).toBeLessThan(d.Rp);
    }
  });

  it("swings the arm across the record as the latitude changes, on the near side of the line to the pivot, and smoothly", () => {
    const d = deckOf(W, H);
    const e = [Math.cos(d.alpha), Math.sin(d.alpha)] as const;
    let prev: [number, number] | null = null;
    for (let lat = NEEDLE_LAT[1]; lat >= NEEDLE_LAT[0]; lat -= 1) {
      const [ux, uy] = needleOffset(d, lat);
      // Cross product with the spindle-to-pivot direction: never on the far side.
      expect(e[0] * uy - e[1] * ux).toBeGreaterThan(-1e-6);
      if (prev) expect(Math.hypot(ux - prev[0], uy - prev[1])).toBeLessThan(d.R * 0.06);
      prev = [ux, uy];
    }
  });

  it("puts the needle's place exactly under the needle, which is on the frame's centre once zoomed in", () => {
    for (const [lon, lat] of SPOTS) {
      const la = Math.max(NEEDLE_LAT[0], Math.min(NEEDLE_LAT[1], lat));
      for (const zoom of [1, 1.1, 1.2, 2.5, 9]) {
        const proj = record(lon, la, zoom);
        const p = proj([lon, la])!;
        const [nx, ny] = needleAt(W, H, la, zoom);
        expect(p[0], `${lon},${la} z${zoom}`).toBeCloseTo(nx, 5);
        expect(p[1], `${lon},${la} z${zoom}`).toBeCloseTo(ny, 5);
        const v = viewOf(W, H, la, zoom);
        expect(proj.translate()[0]).toBeCloseTo(v.sx, 9);
        expect(proj.translate()[1]).toBeCloseTo(v.sy, 9);
        if (zoom >= 1 + CAM_ZOOM) {
          expect(nx).toBeCloseTo(W / 2, 6);
          expect(ny).toBeCloseTo(H / 2, 6);
        }
      }
    }
  });

  it("moves the camera smoothly from the whole deck to riding with the needle", () => {
    let prev = needleAt(W, H, 30, 1);
    for (let z = 1; z <= 2; z += 0.01) {
      const q = needleAt(W, H, 30, z);
      expect(Math.hypot(q[0] - prev[0], q[1] - prev[1])).toBeLessThan(10);
      prev = q;
      // The needle never leaves the frame as the camera moves.
      expect(q[0]).toBeGreaterThan(0);
      expect(q[0]).toBeLessThan(W);
      expect(q[1]).toBeGreaterThan(0);
      expect(q[1]).toBeLessThan(H);
    }
  });

  it("draws markers where the turning picture's land is: the picture rotated about the spindle is the record's projection", () => {
    for (const [w, h] of [
      [W, H],
      [390, 470],
    ] as const) {
      const d = deckOf(w, h);
      const side = Math.ceil(d.Rp * 2 + 6);
      const rest = restProjection(d.R / EDGE_R, side / 2, side);
      let n = 0;
      for (const [nlon, nlat] of [
        [10, 30],
        [-100, 10],
        [140, -40],
        [36.8, -1.3],
      ] as const) {
        const v = viewOf(w, h, nlat, 1);
        const rot = turnOf(v, nlon);
        const proj = record(nlon, nlat, 1, w, h);
        for (const [lon, lat] of SPOTS) {
          if (lat < -88 || 90 - lat <= CAP) continue;
          const q = rest([lon, lat])!;
          // Rotate the picture's point about the spindle and move the spindle into place, as the draw does.
          const dx = q[0] - side / 2;
          const dy = q[1] - side / 2;
          const x = v.sx + dx * Math.cos(rot) - dy * Math.sin(rot);
          const y = v.sy + dx * Math.sin(rot) + dy * Math.cos(rot);
          const p = proj([lon, lat])!;
          expect(Math.hypot(p[0] - x, p[1] - y), `${w}x${h} ${nlon},${nlat} at ${lon},${lat}`).toBeLessThan(1e-6);
          n++;
        }
      }
      expect(n).toBeGreaterThan(200);
    }
  });

  it("is seen from above the North Pole and never mirrored: east of the needle is anticlockwise round the spindle, north toward it", () => {
    for (const [lon, lat] of [
      [0, 20],
      [36.8, -1.3],
      [-120, 50],
      [150, -35],
    ] as const) {
      const proj = record(lon, lat);
      const [sx, sy] = proj.translate();
      const [nx, ny] = needleAt(W, H, lat, 1);
      const east = proj([lon + 1, lat])!;
      const north = proj([lon, lat + 1])!;
      const a0 = Math.atan2(ny - sy, nx - sx);
      let da = Math.atan2(east[1] - sy, east[0] - sx) - a0;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      // On a y-down screen a smaller angle is anticlockwise.
      expect(da).toBeLessThan(0);
      expect(Math.hypot(north[0] - sx, north[1] - sy)).toBeLessThan(Math.hypot(nx - sx, ny - sy));
      // The parallels are circles round the spindle: every point of one is the same distance from it.
      const dist = (q: [number, number]) => Math.hypot(q[0] - sx, q[1] - sy);
      expect(dist(proj([lon + 90, lat])!)).toBeCloseTo(dist(proj([lon - 135, lat])!), 6);
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

  it("keeps the grabbed point under the finger as the record is dragged round its spindle, and swings the arm for the rest", () => {
    let turned = 0;
    let swung = 0;
    for (const [lon, lat] of [
      [10, 30],
      [36.8, -1.3],
      [-75, 45],
      [120, -20],
    ] as const) {
      const proj = record(lon, lat);
      const [sx, sy] = proj.translate();
      const [nx, ny] = needleAt(W, H, lat, 1);
      const r = Math.hypot(nx - sx, ny - sy);
      const a0 = Math.atan2(ny - sy, nx - sx);
      // Round the spindle at the needle's own distance: the latitude holds and the grabbed point follows the finger.
      for (const da of [0.3, -0.5, 1.2]) {
        const grabbed = proj.invert!([nx, ny])!;
        const to: [number, number] = [sx + r * Math.cos(a0 + da), sy + r * Math.sin(a0 + da)];
        const [nlon, nlat] = dragRecord(lon, lat, 1, W, H, [nx, ny], to);
        expect(nlat).toBeCloseTo(lat, 6);
        const q = record(nlon, nlat)(grabbed)!;
        expect(Math.hypot(q[0] - to[0], q[1] - to[1]), `${lon},${lat} by ${da}`).toBeLessThan(0.05);
        // Dragged clockwise, the record turns clockwise under the needle: the longitude under it grows.
        expect(Math.sign(((nlon - lon + 540) % 360) - 180)).toBe(Math.sign(da));
        turned++;
      }
      // In or out along the spindle's line through the finger: the needle moves by as much, the longitude holds.
      for (const dr of [-30, 25]) {
        const f: [number, number] = [sx + (r + 10) * Math.cos(a0), sy + (r + 10) * Math.sin(a0)];
        const to: [number, number] = [sx + (r + 10 + dr) * Math.cos(a0), sy + (r + 10 + dr) * Math.sin(a0)];
        const [nlon, nlat] = dragRecord(lon, lat, 1, W, H, f, to);
        expect(Math.abs(((nlon - lon + 540) % 360) - 180)).toBeLessThan(1e-6);
        const [mx, my] = needleAt(W, H, nlat, 1);
        const [px, py] = record(nlon, nlat).translate();
        // Pulled outward, the needle goes inward by as much, as a map dragged under a centre does.
        if (nlat > NEEDLE_LAT[0] && nlat < NEEDLE_LAT[1]) expect(Math.hypot(mx - px, my - py)).toBeCloseTo(r - dr, 4);
        swung++;
      }
    }
    expect(turned).toBe(12);
    expect(swung).toBe(8);
  });

  it("keeps the grabbed point under the finger when zoomed in too, where the camera rides with the needle", () => {
    for (const zoom of [1.2, 2.5, 9]) {
      for (const [lon, lat] of [
        [10, 30],
        [-75, 45],
        [120, -20],
      ] as const) {
        const proj = record(lon, lat, zoom);
        const [sx, sy] = proj.translate();
        const [nx, ny] = needleAt(W, H, lat, zoom);
        const r = Math.hypot(nx - sx, ny - sy);
        const a0 = Math.atan2(ny - sy, nx - sx);
        const grabbed = proj.invert!([nx, ny])!;
        const to: [number, number] = [sx + r * Math.cos(a0 + 0.1), sy + r * Math.sin(a0 + 0.1)];
        const [nlon, nlat] = dragRecord(lon, lat, zoom, W, H, [nx, ny], to);
        expect(nlat).toBeCloseTo(lat, 6);
        const q = record(nlon, nlat, zoom)(grabbed)!;
        expect(Math.hypot(q[0] - to[0], q[1] - to[1]), `${lon},${lat} z${zoom}`).toBeLessThan(0.05);
      }
    }
  });

  it("lets the arrow keys turn the record sideways and swing the arm up and down, each leaving the other alone", () => {
    const [nx, ny] = needleAt(W, H, 30, 1);
    const [tlon, tlat] = dragRecord(10, 30, 1, W, H, [nx, ny], [nx + 40, ny], "turn");
    expect(tlat).toBe(30);
    expect(tlon).not.toBeCloseTo(10, 3);
    const [slon, slat] = dragRecord(10, 30, 1, W, H, [nx, ny], [nx, ny + 40], "swing");
    expect(slon).toBe(10);
    expect(slat).not.toBeCloseTo(30, 3);
  });

  it("only turns the record when it is grabbed on the label or beyond its edge", () => {
    const [sx, sy] = [viewOf(W, H, 30, 1).sx, viewOf(W, H, 30, 1).sy];
    const s = recordScale(W, H, 1);
    const onLabel: [number, number] = [sx + s * LABEL_R * 0.5, sy];
    const [, lat] = dragRecord(0, 30, 1, W, H, onLabel, [onLabel[0] + 5, onLabel[1] + 40]);
    expect(lat).toBe(30);
    const rim: [number, number] = [sx, sy - deckOf(W, H).Rp * 0.99];
    expect(dragRecord(0, 30, 1, W, H, rim, [rim[0] + 5, rim[1] - 30])[1]).toBe(30);
  });

  it("keeps the needle between the centre label and the record's edge", () => {
    const [lon, lat] = dragRecord(0, 60, 1, W, H, [W / 2 + 200, H / 2], [W / 2 + 200, H / 2 - 5000]);
    expect(lat).toBeLessThanOrEqual(NEEDLE_LAT[1]);
    expect(lat).toBeGreaterThanOrEqual(NEEDLE_LAT[0]);
    expect(Number.isFinite(lon)).toBe(true);
    expect(NEEDLE_LAT[1]).toBeLessThan(90 - CAP);
  });

  it("knows how far the record must turn to bring a place on the needle's ring under the needle", () => {
    for (const [lon, lat] of [
      [10, 30],
      [-120, 50],
      [150, -35],
    ] as const) {
      const proj = record(lon, lat);
      for (const ahead of [3, 20, 40, 120, 300]) {
        // A place `ahead` degrees of longitude east of the needle on its parallel comes to the needle after the record turns that far.
        const p = proj([lon + ahead, lat])!;
        const turn = turnToNeedle(W, H, lat, 1, p[0], p[1], 5);
        expect(turn).not.toBeNull();
        expect(turn!).toBeCloseTo(ahead, 4);
        // Its place is under the needle once the longitude has gone that far.
        const q = record(lon + ahead, lat)([lon + ahead, lat])!;
        const [nx, ny] = needleAt(W, H, lat, 1);
        expect(Math.hypot(q[0] - nx, q[1] - ny)).toBeLessThan(1e-6);
      }
      // A place on another ring is not on the needle's.
      const off = proj([lon + 30, lat - 12])!;
      expect(turnToNeedle(W, H, lat, 1, off[0], off[1], 5)).toBeNull();
    }
    expect(BRAKE_DEG).toBeGreaterThan(10);
    expect(BRAKE_DEG).toBeLessThan(90);
  });

  it("covers no place with the centre label, at any zoom", () => {
    const places = allPlaces();
    expect(places.length).toBeGreaterThan(1000);
    const north = Math.max(...places.map((p) => p.lat));
    expect(90 - north).toBeGreaterThan(CAP + 0.5);
    // On screen too: every place's point lies outside the label's edge. Markers are drawn over the label in any case.
    for (const zoom of [1, 4, 14]) {
      const s = recordScale(W, H, zoom);
      const gap = s * (radiusOf((90 - north) / DEG) - LABEL_R);
      expect(gap, `zoom ${zoom}`).toBeGreaterThan(zoom === 1 ? 8 : 20);
    }
    // The tuning reaches the northernmost place: the needle can go past it.
    expect(NEEDLE_LAT[1]).toBeGreaterThan(north);
  });

  it("fills Antarctica as land between its coast and the record's edge, never the record inside it", () => {
    const topo = JSON.parse(readFileSync(here("../public/basemap/world-110m.json"), "utf8")) as Topology;
    const land = polarSafe(feature(topo, topo.objects.land as GeometryCollection) as never) as unknown as FeatureCollection;
    const proj = record(30, 10);
    const disc = Math.PI * (recordScale(W, H, 1) * EDGE_R) ** 2;
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

  it("turns at a steady speed, the 45 a third quicker than the 33, and never fast enough to flash", () => {
    expect(SPIN_DEG[45] / SPIN_DEG[33]).toBeCloseTo(45 / 33, 1);
    expect(SPIN_DEG[33]).toBeGreaterThan(60);
    // Cream land on black is the contrast that turns, so count the stretches of land a point on each parallel passes in
    // a turn, those wide enough to be a large area (20 degrees of longitude, 70 pixels or more on the record): at the
    // quicker speed the most of them crossing a point must stay under three a second.
    const topo = JSON.parse(readFileSync(here("../public/basemap/world-110m.json"), "utf8")) as Topology;
    const land = feature(topo, topo.objects.land as GeometryCollection) as never;
    let most = 0;
    for (let lat = -70; lat <= 80; lat += 5) {
      let patches = 0;
      let start: number | null = null;
      for (let lon = -180; lon <= 180; lon += 2) {
        const now = geoContains(land, [lon, lat]);
        if (now && start === null) start = lon;
        if ((!now || lon === 180) && start !== null) {
          if (lon - start >= 20) patches++;
          start = null;
        }
      }
      most = Math.max(most, patches);
    }
    expect(most).toBeGreaterThan(2);
    const perSecond = most * (SPIN_DEG[45] / 360);
    expect(perSecond, `${most} patches in a turn`).toBeLessThan(3);
  });

  it("never flashes in light: the sheen, the only light that turns, stays under a tenth of full brightness", () => {
    expect(SHEEN_MAX).toBeLessThan(0.1);
  });
});
