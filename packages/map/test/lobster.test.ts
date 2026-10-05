// Lobster (src/map/lobster.ts): the drawings at sea sit only where their whole circle of open water is clear of land and
// far from every place, each drawing stays inside that circle at every zoom, the pieces on the dock keep clear of the
// globe's coil, the buttons and each other, soundings keep clear of land and places, the same inputs give the same
// picture, and nothing moves.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { geoContains, geoDistance } from "d3-geo";
import type { FeatureCollection } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";
import { BASEMAPS, inLand, landOf } from "./basemaps.ts";
import { ambientDelay } from "../src/map/ambient.ts";
import { buoyBand, markPath } from "../src/map/marks.ts";
import { coilOf, GAP, graticuleStep, KEY_BOX, pathPoints, placeDock, REACH, SEA, SEA_FILL, seaUnit, shapeParts, soundClear, soundings, soundStep, ZOOM_BOX, type Kind } from "../src/map/lobster.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";
import { HAUL_MS } from "../src/ui/lobster.ts";
import { samplePlaces } from "./sample.ts";
import { cssFor } from "./css.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RAD = Math.PI / 180;

function land(file: string): FeatureCollection {
  const topo = JSON.parse(readFileSync(here(`../public/basemap/${file}`), "utf8")) as Topology;
  return feature(topo, topo.objects.land as GeometryCollection) as FeatureCollection;
}

/** Every outlet's city on the world and briefing desks, and every place in the sample day, tiles included. */
function places(): [number, number][] {
  const yaml = readFileSync(here("../../../config/sources.yaml"), "utf8");
  const out: [number, number][] = [...yaml.matchAll(/lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)/g)].map((m) => [Number(m[2]), Number(m[1])]);
  for (const p of samplePlaces()) out.push([p.lon, p.lat]);
  return out;
}

/** The spot and points on two circles round it, half and all of its radius out. */
function ring(lon: number, lat: number, deg: number): [number, number][] {
  const pts: [number, number][] = [[lon, lat]];
  for (const f of [0.5, 1]) {
    for (let a = 0; a < 360; a += 15) {
      const dLat = f * deg * Math.cos(a * RAD);
      const dLon = (f * deg * Math.sin(a * RAD)) / Math.cos((lat + dLat) * RAD);
      pts.push([lon + dLon, lat + dLat]);
    }
  }
  return pts;
}

const SIZES: [number, number][] = [
  [1000, 645],
  [1400, 900],
  [1920, 1000],
  [700, 400],
  [600, 900],
  [390, 520],
  [390, 300],
  [360, 440],
];

describe("Lobster", () => {
  it("is in the Design menu, in one group and not featured, with a buoy mark and a fresh colour of its own (decision 138)", () => {
    const t = THEMES.lobster;
    expect(t.experimental).toBeFalsy();
    expect(t.dotShape).toBe("buoy");
    expect(t.fresh).not.toBe(t.dot);
    expect(DESIGN_GROUPS.filter((g) => g.ids.includes("lobster"))).toHaveLength(1);
    expect(FEATURED).not.toContain("lobster");
  });

  it("holds still: no motion, no frames asked for", () => {
    const t = THEMES.lobster;
    expect(t.motion).toBeFalsy();
    expect(t.scene).toBeUndefined();
    const had = globalThis.matchMedia;
    globalThis.matchMedia = (() => ({ matches: false })) as unknown as typeof matchMedia;
    try {
      expect(ambientDelay(THEMES.aquarium)).toBeGreaterThan(0);
      expect(ambientDelay(t)).toBe(0);
    } finally {
      globalThis.matchMedia = had;
    }
  });

  it("never paints land in lobster red", () => {
    const t = THEMES.lobster;
    const red = (c: string) => {
      const n = parseInt(c.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      return r > 150 && r > g * 1.6 && r > b * 1.6;
    };
    for (const c of [t.land, t.ice, t.ocean, t.coast]) expect(red(c), c).toBe(false);
  });

  it("draws the buoy mark as one closed outline with a band inside it", () => {
    const d = markPath("buoy", 6);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect((d.match(/M/g) ?? []).length).toBe(1);
    for (const [x, y] of pathPoints(d)) expect(Math.hypot(x, y)).toBeLessThan(6 * 1.5);
    // The band is a straight line across the float, inside it.
    const [x0, y0, x1] = (buoyBand(6).match(/-?\d*\.?\d+/g) ?? []).map(Number);
    expect(x0).toBeCloseTo(-x1!, 5);
    expect(y0).toBeGreaterThan(0);
    expect(Math.abs(x0!)).toBeLessThan(6 * 0.95);
  });

  for (const file of BASEMAPS) {
    it(`keeps every drawing's whole circle of open water off land (${file})`, () => {
      const l = landOf(file);
      for (const s of SEA) {
        for (const p of ring(s.lon, s.lat, s.r)) expect(inLand(l, p), `${s.kind} at ${s.lat},${s.lon}`).toBe(false);
      }
    }, 60_000);
  }

  it("keeps every drawing at least 3 degrees clear of every place, and no two overlap", () => {
    const all = places();
    expect(all.length).toBeGreaterThan(50);
    for (const s of SEA) {
      const nearest = Math.min(...all.map((p) => geoDistance(p, [s.lon, s.lat]) / RAD));
      expect(nearest - s.r, `${s.kind} at ${s.lat},${s.lon}`).toBeGreaterThan(3);
    }
    for (const [i, a] of SEA.entries()) {
      for (const b of SEA.slice(i + 1)) expect(geoDistance([a.lon, a.lat], [b.lon, b.lat]) / RAD).toBeGreaterThan(a.r + b.r);
    }
  });

  it("draws each drawing inside its reach, and its reach inside the open water at every scale", () => {
    for (const kind of ["boat", "lobster", "pot", "rose", "coil", "oar"] as Kind[]) {
      const parts = shapeParts(kind);
      expect(parts.length).toBeGreaterThan(2);
      for (const p of parts) {
        const pts = pathPoints(p.d);
        expect(pts.length).toBeGreaterThan(1);
        // The widest stroke's half width is added to every point.
        for (const [x, y] of pts) expect(Math.hypot(x, y) + (p.w ?? 0) / 2, kind).toBeLessThan(REACH - 0.05);
      }
    }
    for (const pxDeg of [0.8, 2, 4, 9, 30, 120, 600]) {
      for (const s of SEA) expect(seaUnit(s.r, pxDeg) * REACH).toBeLessThanOrEqual(SEA_FILL * s.r * pxDeg + 1e-9);
    }
    expect(SEA_FILL).toBeLessThan(1);
  });

  it("has no text and no small filled circle in any drawing", () => {
    for (const kind of ["boat", "lobster", "pot", "rose", "coil", "oar"] as Kind[]) {
      for (const p of shapeParts(kind)) {
        expect(p.d).not.toMatch(/[^MLZ0-9.\-e ]/);
        // A translucent highlight on a body is not a mark of its own.
        if (!p.fill || p.fill.startsWith("rgba")) continue;
        // A filled part is a drawing's body: a filled shape within 0.12 units across and round would read as a dot.
        const pts = pathPoints(p.d);
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
        const dot = w < 0.2 && h < 0.2 && Math.abs(w - h) < 0.06 && pts.length > 10;
        expect(dot, `${kind} ${p.d.slice(0, 24)}`).toBe(false);
      }
    }
  });

  it("lays the dock's pieces clear of the globe's coil, the buttons, the frame and each other, the same every time", () => {
    let placed = 0;
    for (const [w, h] of SIZES) {
      for (const zoom of [0.8, 1, 1.3, 1.8, 3]) {
        const R = Math.min(w, h) * (THEMES.lobster.globeScale ?? 0.46) * zoom;
        const cx = w / 2, cy = h / 2;
        const list = placeDock(w, h, cx, cy, R);
        expect(placeDock(w, h, cx, cy, R)).toEqual(list);
        const outer = coilOf(R).outer;
        for (const [i, p] of list.entries()) {
          const at = `${w}x${h} zoom ${zoom} ${p.kind}`;
          const r = p.u * REACH;
          expect(Math.hypot(p.x - cx, p.y - cy) - r, at).toBeGreaterThanOrEqual(outer + GAP - 1e-6);
          expect(p.x - r, at).toBeGreaterThanOrEqual(0);
          expect(p.x + r, at).toBeLessThanOrEqual(w);
          expect(p.y - r, at).toBeGreaterThanOrEqual(0);
          expect(p.y + r, at).toBeLessThanOrEqual(h);
          const nx = Math.min(Math.max(p.x, 0), KEY_BOX.w), ny = Math.min(Math.max(p.y, 0), KEY_BOX.h);
          expect(Math.hypot(p.x - nx, p.y - ny), `${at}: Key`).toBeGreaterThanOrEqual(r);
          const zx = Math.min(Math.max(p.x, w - ZOOM_BOX.w), w), zy = Math.min(Math.max(p.y, h - ZOOM_BOX.h), h);
          expect(Math.hypot(p.x - zx, p.y - zy), `${at}: zoom`).toBeGreaterThanOrEqual(r);
          for (const o of list.slice(i + 1)) expect(Math.hypot(p.x - o.x, p.y - o.y), at).toBeGreaterThanOrEqual(r + o.u * REACH + GAP - 1e-6);
          placed++;
        }
      }
    }
    expect(placed).toBeGreaterThan(20);
    // A wide frame has room for a lobster.
    expect(placeDock(1400, 900, 700, 450, 324).some((p) => p.kind === "lobster")).toBe(true);
  });

  it("keeps soundings off land and away from every place, the same for the same window", () => {
    const l = land("world-110m.json");
    const all = places();
    const blocked = (lon: number, lat: number, clear: number) => {
      for (let a = 0; a < 360; a += 45) if (geoContains(l, [lon + clear * Math.sin(a * RAD), lat + clear * Math.cos(a * RAD)])) return true;
      if (geoContains(l, [lon, lat])) return true;
      return all.some((q) => geoDistance(q, [lon, lat]) / RAD < clear);
    };
    let count = 0;
    for (const pxDeg of [1.5, 8]) {
      const step = soundStep(pxDeg);
      expect(step * pxDeg).toBeLessThanOrEqual(70);
      const clear = soundClear(step, pxDeg);
      expect(clear).toBeLessThanOrEqual(3);
      const box = { lon0: -40, lon1: 70, lat0: -40, lat1: 40 };
      const a = soundings(box, step, clear, blocked);
      expect(soundings(box, step, clear, blocked)).toEqual(a);
      for (const s of a) {
        expect(blocked(s.lon, s.lat, clear), `${s.lat},${s.lon}`).toBe(false);
      }
      count += a.length;
    }
    expect(count).toBeGreaterThan(15);
    // A cell keeps its mark wherever the window starts: the world turns once in 360 degrees.
    const free = () => false;
    const x = soundings({ lon0: 10, lon1: 20, lat0: 0, lat1: 10 }, 2, 0.5, free);
    const y = soundings({ lon0: 370, lon1: 380, lat0: 0, lat1: 10 }, 2, 0.5, free);
    expect(y.length).toBe(x.length);
    expect(x.length).toBeGreaterThan(0);
    for (const [i, s] of x.entries()) {
      expect(y[i]!.lon).toBeCloseTo(s.lon, 6);
      expect(y[i]!.lat).toBeCloseTo(s.lat, 6);
    }
    expect(graticuleStep(10)).toBeGreaterThanOrEqual(5);
    expect(graticuleStep(10) * 10).toBeGreaterThanOrEqual(60);
  });

  it("hauls the panel for under a second, well inside the flash limit's third-of-a-second rule for light", () => {
    // Only the panel's position moves; no colour or brightness changes, so the flash limit is not in play.
    expect(HAUL_MS).toBeLessThan(1000);
    const css = cssFor("lobster");
    const block = css.slice(css.indexOf("@keyframes lb-haul"), css.indexOf("@keyframes lb-haul") + 400);
    expect(block).toMatch(/transform/);
    expect(block).not.toMatch(/opacity|filter|background|color/);
  });

  it("never uses a style attribute, an em dash or innerHTML in its own files", () => {
    for (const f of ["../src/map/lobster.ts", "../src/ui/lobster.ts"]) {
      const s = readFileSync(here(f), "utf8");
      expect(s).not.toMatch(/innerHTML|setAttribute\("style"/);
      expect(s).not.toMatch(/—/);
    }
  });
});
