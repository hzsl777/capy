// Folding Cube (src/map/fold.ts): the world on a cube and on its flat net. The reticle's place is always drawn at the
// frame's centre, a place on a face turned away is neither drawn nor tuned, the net and its inverse agree, and each
// face's gnomonic projection puts the world where the cube's geometry says.
import { geoGnomonic } from "d3-geo";
import { describe, expect, it } from "vitest";
import {
  Camera,
  clampNet,
  faceLocal,
  faceOf,
  FACES,
  foldBase,
  foldPlace,
  INTRO_MS,
  introPose,
  netInvert,
  netPoint,
  restingPose,
  turnPose,
  unit,
} from "../src/map/fold.ts";

/** Places spread over the whole sphere, poles and the antimeridian included. */
const PLACES: [number, number][] = [];
for (let lat = -88; lat <= 88; lat += 11) for (let lon = -179; lon < 180; lon += 13) PLACES.push([lon, lat]);
PLACES.push([0, 0], [45, 0], [180, 0], [-135, 35.26], [36.82, -1.29], [151.2, -33.87], [-70.6, -33.45]);

const W = 900;
const H = 640;
const camera = (mode: "2d" | "3d", lon: number, lat: number, zoom = 1) => new Camera(restingPose(mode, lon, lat, foldBase(mode, W, H) * zoom), W, H);

describe("cube faces", () => {
  it("each face's gnomonic projection matches the cube's own coordinates", () => {
    for (const [lon, lat] of PLACES) {
      const p = unit(lon, lat);
      const i = faceOf(p);
      const [u, v] = faceLocal(i, p);
      expect(Math.abs(u)).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-9);
      const q = geoGnomonic().rotate(FACES[i]!.rotate).scale(1).translate([0, 0])([lon, lat])!;
      expect(q[0]).toBeCloseTo(u, 6);
      expect(q[1]).toBeCloseTo(-v, 6);
    }
  });

  it("the net and its inverse agree", () => {
    for (const [lon, lat] of PLACES) {
      const [x, y] = netPoint(lon, lat);
      expect(clampNet(x, y)).toEqual([x, y]);
      const [lon2, lat2] = netInvert(x, y);
      expect(lat2).toBeCloseTo(lat, 6);
      if (Math.abs(lat) < 89) expect(Math.abs(((lon2 - lon + 540) % 360) - 180)).toBeLessThan(1e-6);
    }
  });

  it("keeps a point off the net's cross on its nearest edge", () => {
    expect(clampNet(3, 2.5)).toEqual([3, 1]);
    expect(clampNet(-2.2, -2.9)).toEqual([-1, -2.9]);
    expect(clampNet(9, 0.5)).toEqual([5, 0.5]);
  });
});

describe("the reticle's place", () => {
  for (const mode of ["2d", "3d"] as const) {
    it(`is drawn at the frame's centre in ${mode === "2d" ? "Map" : "Globe"} view`, () => {
      for (const [lon, lat] of PLACES) {
        if (mode === "3d" && Math.abs(lat) > 80) continue;
        for (const zoom of [1, 3.7]) {
          const p = foldPlace(camera(mode, lon, lat, zoom), lon, lat);
          expect(p, `${lon},${lat}`).not.toBeNull();
          expect(p!.x).toBeCloseTo(W / 2, 6);
          expect(p!.y).toBeCloseTo(H / 2, 6);
        }
      }
    });
  }

  it("never shows a place on a face turned away in Globe view", () => {
    for (const [lon, lat] of PLACES.filter((_, j) => j % 4 === 0)) {
      if (Math.abs(lat) > 80) continue;
      const cam = camera("3d", lon, lat);
      const far = foldPlace(cam, lon + 180, -lat);
      expect(far).toBeNull();
      for (const [plon, plat] of PLACES.filter((_, j) => j % 3 === 0)) {
        const i = faceOf(unit(plon, plat));
        const p = foldPlace(cam, plon, plat);
        if (cam.facing[i]! <= 0) expect(p).toBeNull();
      }
    }
  });

  it("shows every place on the flat net, each face once", () => {
    const cam = camera("2d", 20, 10);
    for (let i = 0; i < 6; i++) expect(cam.facing[i]).toBeCloseTo(1, 9);
    for (const [lon, lat] of PLACES) expect(foldPlace(cam, lon, lat)).not.toBeNull();
  });

  it("lies where the face is drawn: a place's point is the face's point under it", () => {
    const cam = camera("3d", 100, 25);
    for (const [lon, lat] of PLACES) {
      const p = foldPlace(cam, lon, lat);
      if (!p) continue;
      const i = faceOf(unit(lon, lat));
      const [u, v] = faceLocal(i, unit(lon, lat));
      const [x, y] = cam.at(i, u, v);
      expect(p.x).toBeCloseTo(x, 9);
      expect(p.y).toBeCloseTo(y, 9);
    }
  });
});

describe("the fold and the opening", () => {
  it("folding the net closes the cube: neighbouring faces meet along their edges", () => {
    const cam = camera("3d", 30, 20);
    // The middle face's right edge is the east face's left edge, and its top edge the north face's bottom edge.
    for (const t of [-1, -0.3, 0.5, 1]) {
      const a = cam.at(0, 1, t);
      const b = cam.at(1, -1, t);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-6);
      const c = cam.at(0, t, 1);
      const d = cam.at(4, t, -1);
      expect(Math.hypot(c[0] - d[0], c[1] - d[1])).toBeLessThan(1e-6);
    }
  });

  it("ends exactly at rest", () => {
    for (const mode of ["2d", "3d"] as const) {
      const rest = restingPose(mode, 36.82, -1.29, 120);
      const end = introPose(rest, INTRO_MS - 1e-6, W, H);
      expect(end.k).toBeCloseTo(rest.k, 3);
      expect(end.theta).toBeCloseTo(rest.theta, 6);
      const other = restingPose(mode === "2d" ? "3d" : "2d", 36.82, -1.29, 90);
      const turned = turnPose(other, rest, 1);
      expect(turned.c).toEqual(rest.c);
      expect(turned.theta).toBeCloseTo(rest.theta, 9);
    }
  });
});
