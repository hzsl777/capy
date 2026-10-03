// First Render (src/map/render.ts): the ball's faces cover the sphere and face outward, the facets are cut from a
// fixed grid the same way every time, the lamp keeps clear of the ball and the buttons, and its turning shade never
// changes brightness quickly.
import { describe, expect, it } from "vitest";
import { classifyFaces, gridPoint, gridStep, icosphere, KEY_BOX, lampBox, levelFor, lonLatOf, placeLamp, screenOf, shadeLight, ZOOM_BOX } from "../src/map/render.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The solid angle a spherical triangle covers (Van Oosterom and Strackee). */
function solidAngle(a: V3, b: V3, c: V3): number {
  const num = Math.abs(dot(a, cross(b, c)));
  const den = 1 + dot(a, b) + dot(b, c) + dot(c, a);
  return 2 * Math.atan2(num, den);
}

const SIZES: [number, number][] = [
  [1000, 645],
  [1400, 900],
  [1920, 1000],
  [700, 400],
  [600, 900],
  [390, 300],
  [390, 520],
  [360, 440],
];

describe("First Render", () => {
  it("is experimental, so it opens only from a link and stays off the Design menu", () => {
    const t = THEMES.render;
    expect(t.experimental).toBe(true);
    expect(DESIGN_GROUPS.flatMap((g) => g.ids)).not.toContain("render");
    expect(FEATURED).not.toContain("render");
    expect(t.fresh).not.toBe(t.dot);
  });

  it("builds a ball whose faces cover the whole sphere once, each wound outward", () => {
    for (const level of [0, 1, 2, 3]) {
      const { verts, faces } = icosphere(level);
      expect(faces.length).toBe(20 * 4 ** level);
      for (const v of verts) expect(Math.hypot(...v)).toBeCloseTo(1, 9);
      let total = 0;
      for (const [a, b, c] of faces) {
        const A = verts[a]!, B = verts[b]!, C = verts[c]!;
        const n = cross(sub(B, A), sub(C, A));
        expect(dot(n, [A[0] + B[0] + C[0], A[1] + B[1] + C[1], A[2] + B[2] + C[2]])).toBeGreaterThan(0);
        total += solidAngle(A, B, C);
      }
      expect(total).toBeCloseTo(4 * Math.PI, 6);
    }
  });

  it("keeps a few hundred faces at the usual globe size", () => {
    for (const [w, h] of SIZES) {
      const R = Math.min(w, h) * (THEMES.render.globeScale ?? 0.46);
      const n = icosphere(levelFor(R)).faces.length;
      expect(n, `${w}x${h}`).toBeGreaterThanOrEqual(320);
      expect(n, `${w}x${h}`).toBeLessThanOrEqual(1280);
    }
  });

  it("decides land faces from the land under them alone, the same way every time", () => {
    // A made-up world: land east of the prime meridian, ice nowhere.
    const isLand = (lon: number) => lon > 0;
    const a = classifyFaces(3, isLand, () => false);
    const b = classifyFaces(3, isLand, () => false);
    expect(a).toEqual(b);
    const { verts, faces } = icosphere(3);
    faces.forEach(([p, q, r], i) => {
      const lons = [verts[p]!, verts[q]!, verts[r]!].map((v) => lonLatOf(v)[0]);
      if (lons.every((l) => l > 1 && l < 179)) expect(a.land[i]).toBe(true);
      if (lons.every((l) => l < -1 && l > -179)) expect(a.land[i]).toBe(false);
    });
    const share = a.land.filter(Boolean).length / a.land.length;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6);
  });

  it("cuts the map's facets from a fixed grid that wraps round the world", () => {
    for (const step of [10, 5, 2.5, 1.25, 0.625]) {
      const n = Math.round(360 / step);
      for (const [i, j] of [
        [0, 0],
        [7, -3],
        [-12, 5],
        [n - 1, 2],
      ] as [number, number][]) {
        const p = gridPoint(step, i, j);
        expect(gridPoint(step, i, j)).toEqual(p);
        const q = gridPoint(step, i + n, j);
        expect(q[0] - p[0]).toBeCloseTo(360, 9);
        expect(q[1]).toBeCloseTo(p[1], 9);
        expect(Math.abs(p[0] - i * step)).toBeLessThanOrEqual(0.3 * step);
        expect(Math.abs(p[1] - j * step)).toBeLessThanOrEqual(0.3 * step);
      }
      // The poles stay at the poles, so the top and bottom rows close up.
      expect(gridPoint(step, 3, Math.round(90 / step))[1]).toBe(90);
      expect(gridPoint(step, 3, -Math.round(90 / step))[1]).toBe(-90);
    }
    // A facet's side stays a few dozen pixels at every zoom.
    for (const pxPerDeg of [2, 3.9, 8, 20, 60, 200]) {
      const side = gridStep(pxPerDeg) * pxPerDeg;
      expect(side).toBeLessThanOrEqual(45);
      if (gridStep(pxPerDeg) < 10) expect(side).toBeGreaterThan(20);
      expect(90 / gridStep(pxPerDeg)).toBe(Math.round(90 / gridStep(pxPerDeg)));
    }
  });

  it("keeps the lamp clear of the ball, the Key, the zoom buttons and the frame's edge at every zoom", () => {
    let placed = 0;
    for (const [w, h] of SIZES) {
      const baseR = Math.min(w, h) * (THEMES.render.globeScale ?? 0.46);
      for (const zoom of [1, 1.2, 1.6, 2.2, 4]) {
        const R = baseR * zoom;
        const lamp = placeLamp(w, h, w / 2, h / 2, R, baseR);
        if (!lamp) continue;
        placed++;
        const b = lampBox(lamp);
        const nx = Math.min(Math.max(w / 2, b.x0), b.x1), ny = Math.min(Math.max(h / 2, b.y0), b.y1);
        expect(Math.hypot(nx - w / 2, ny - h / 2), `${w}x${h} zoom ${zoom}`).toBeGreaterThan(R + 8);
        expect(b.x0).toBeGreaterThanOrEqual(0);
        expect(b.y0).toBeGreaterThanOrEqual(0);
        expect(b.x1).toBeLessThanOrEqual(w);
        expect(b.y1).toBeLessThanOrEqual(h);
        expect(b.x0 < KEY_BOX.w && b.y0 < KEY_BOX.h, `${w}x${h}: under the Key`).toBe(false);
        expect(b.x1 > w - ZOOM_BOX.w && b.y1 > h - ZOOM_BOX.h, `${w}x${h}: behind the zoom buttons`).toBe(false);
      }
    }
    expect(placed).toBeGreaterThan(5);
  });

  it("centres the screen in Map view, so the reticle stays in its middle", () => {
    for (const [w, h] of SIZES) {
      const s = screenOf(w, h);
      expect((s.x0 + s.x1) / 2).toBeCloseTo(w / 2, 9);
      expect((s.y0 + s.y1) / 2).toBeCloseTo(h / 2, 9);
      expect(s.x1 - s.x0 - 2 * s.bevel).toBeGreaterThan(w * 0.8);
    }
  });

  it("turns the lamp's shade too slowly for any facet to change brightness quickly", () => {
    // WCAG 2.3.1: nothing may swing 10% in brightness within a third of a second.
    for (let t = 0; t < 120; t += 0.25) {
      const a = shadeLight(t), b = shadeLight(t + 1 / 3);
      for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(0.1);
    }
  });
});
