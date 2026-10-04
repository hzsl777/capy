// Woodblock (src/map/woodblock.ts): the wave crests sit only where their whole circle of open sea is clear of land
// and far from every place, each drawing stays inside that circle at every zoom, the bands of cloud keep clear of
// the globe and the map's buttons, and nothing moves.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { geoContains, geoDistance } from "d3-geo";
import type { FeatureCollection } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";
import { ambientDelay } from "../src/map/ambient.ts";
import { cloudBands, KEY_BOX, pathPoints, WAVE_FILL, WAVE_REACH, waveParts, waveUnit, WAVES, ZOOM_BOX } from "../src/map/woodblock.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";
import { samplePlaces } from "./sample.ts";

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

describe("Woodblock", () => {
  it("is in the Design menu, in one group and not featured", () => {
    const t = THEMES.woodblock;
    expect(t.experimental).toBeFalsy();
    expect(DESIGN_GROUPS.filter((g) => g.ids.includes("woodblock"))).toHaveLength(1);
    expect(FEATURED).not.toContain("woodblock");
    expect(t.fresh).not.toBe(t.dot);
  });

  it("holds still: no motion, no frames asked for", () => {
    const t = THEMES.woodblock;
    expect(t.motion).toBeFalsy();
    expect(t.scene).toBeUndefined();
    // A reader who has not asked for reduced motion: the designs that move ask for frames, and this one does not.
    const had = globalThis.matchMedia;
    globalThis.matchMedia = (() => ({ matches: false })) as unknown as typeof matchMedia;
    try {
      expect(ambientDelay(THEMES.aquarium)).toBeGreaterThan(0);
      expect(ambientDelay(t)).toBe(0);
    } finally {
      globalThis.matchMedia = had;
    }
  });

  for (const file of ["world-110m.json", "world-50m.json"]) {
    it(`keeps every wave's whole circle of open water off land (${file})`, () => {
      const l = land(file);
      for (const s of WAVES) {
        for (const p of ring(s.lon, s.lat, s.r)) expect(geoContains(l, p), `${s.kind} at ${s.lat},${s.lon}`).toBe(false);
      }
    }, 60_000);
  }

  it("keeps every wave at least 3 degrees clear of every place, and no two waves overlap", () => {
    const all = places();
    expect(all.length).toBeGreaterThan(50);
    for (const s of WAVES) {
      const nearest = Math.min(...all.map((p) => geoDistance(p, [s.lon, s.lat]) / RAD));
      expect(nearest - s.r, `${s.kind} at ${s.lat},${s.lon}`).toBeGreaterThan(3);
    }
    for (const [i, a] of WAVES.entries()) {
      for (const b of WAVES.slice(i + 1)) expect(geoDistance([a.lon, a.lat], [b.lon, b.lat]) / RAD).toBeGreaterThan(a.r + b.r);
    }
  });

  it("draws each wave inside its reach, and its reach inside the open water at every scale", () => {
    for (const kind of ["crest", "rollers"] as const) {
      const parts = waveParts(kind);
      for (const d of Object.values(parts)) {
        const pts = pathPoints(d);
        expect(pts.length).toBeGreaterThan(10);
        // The keyline's half width at the smallest wave drawn (9 pixels a unit) is well under 0.1 of a unit.
        for (const [x, y] of pts) expect(Math.hypot(x, y), kind).toBeLessThan(WAVE_REACH - 0.1);
      }
    }
    // Pixels a degree from a whole world on a phone to the closest zoom.
    for (const pxDeg of [0.8, 2, 4, 9, 30, 120, 600]) {
      for (const s of WAVES) {
        // The open water reaches at least r degrees of latitude, or of distance along a parallel, from the spot,
        // which the flat map and the globe's centre draw at pxDeg pixels a degree or more.
        expect(waveUnit(s.r, pxDeg) * WAVE_REACH).toBeLessThanOrEqual(WAVE_FILL * s.r * pxDeg + 1e-9);
      }
    }
    expect(WAVE_FILL).toBeLessThan(1);
  });

  it("keeps the bands of cloud clear of the globe and the map's buttons at every size and zoom", () => {
    let drawn = 0;
    for (const [w, h] of SIZES) {
      for (const zoom of [0.8, 1, 1.3, 1.8, 3]) {
        const R = Math.min(w, h) * (THEMES.woodblock.globeScale ?? 0.46) * zoom;
        const cx = w / 2, cy = h / 2;
        const bands = cloudBands(w, h, cx, cy, R);
        expect(cloudBands(w, h, cx, cy, R)).toEqual(bands);
        for (const b of bands) {
          const at = `${w}x${h} zoom ${zoom}`;
          // The nearest point of the band's box (and its keyline) to the globe's centre lies outside the globe.
          const nx = Math.min(Math.max(cx, b.x - 2), b.x + b.w + 2);
          const ny = Math.min(Math.max(cy, b.y - 2), b.y + b.h + 2);
          expect(Math.hypot(nx - cx, ny - cy), at).toBeGreaterThan(R + 8);
          expect(b.y - 2, at).toBeGreaterThanOrEqual(0);
          expect(b.y + b.h + 2, at).toBeLessThanOrEqual(h);
          expect(b.x < KEY_BOX.w && b.y < KEY_BOX.h, `${at}: under the Key`).toBe(false);
          expect(b.x + b.w > w - ZOOM_BOX.w && b.y + b.h > h - ZOOM_BOX.h, `${at}: under the zoom buttons`).toBe(false);
          expect(b.w).toBeGreaterThanOrEqual(70);
          drawn++;
        }
      }
    }
    // The room beside the globe on a wide screen gets clouds.
    expect(cloudBands(1400, 640, 700, 320, 256).length).toBeGreaterThanOrEqual(3);
    expect(drawn).toBeGreaterThan(20);
  });
});
