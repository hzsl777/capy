// Herbarium (src/map/herbarium.ts): the pressed specimens at sea sit in tested open water clear of every place, the
// ones round the globe keep off the ball, the Key and the zoom buttons, the foliage's colours come from latitude,
// relief and ice only, and nothing in the design moves.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { geoContains, geoDistance } from "d3-geo";
import type { FeatureCollection } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";
import { BANDS, BLEND, KEY_BOX, leafAt, leafStep, leafTone, mountRadius, mountTapes, placeAround, SPECIMENS, TONES, ZOOM_BOX } from "../src/map/herbarium.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";
import { samplePlaces } from "./sample.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RAD = Math.PI / 180;
const css = readFileSync(here("../src/style.css"), "utf8");
const start = css.indexOf("---- Herbarium (id herbarium");
const next = css.indexOf("\n/* ---- ", start + 10);
const herbCss = css.slice(start, next < 0 ? undefined : next);

function land(file: string): FeatureCollection {
  const topo = JSON.parse(readFileSync(here(`../public/basemap/${file}`), "utf8")) as Topology;
  return feature(topo, topo.objects.land as GeometryCollection) as FeatureCollection;
}

/** Every outlet's city on the world and briefing desks, and every place in the sample day. */
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

/** WCAG contrast between two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = (i: number) => {
      const s = parseInt(hex.slice(i, i + 2), 16) / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * c(1) + 0.7152 * c(3) + 0.0722 * c(5);
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}
const token = (name: string) => herbCss.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`))![1]!;

/** Frames the globe is drawn in: desktop, laptop, tablet and phones, wide and tall. */
const FRAMES: [number, number][] = [
  [1000, 645],
  [978, 596],
  [1400, 900],
  [1920, 1000],
  [700, 400],
  [600, 900],
  [390, 384],
  [366, 300],
  [336, 190],
];

describe("Herbarium", () => {
  it("is experimental, so it opens only from a link and stays off the Design menu", () => {
    const t = THEMES.herbarium;
    expect(t.experimental).toBe(true);
    expect(t.surface).toBe("herbarium");
    expect(DESIGN_GROUPS.flatMap((g) => g.ids)).not.toContain("herbarium");
    expect(FEATURED).not.toContain("herbarium");
    expect(t.fresh).not.toBe(t.dot);
  });

  it("has a stylesheet section of its own, with nothing that moves", () => {
    expect(herbCss.length).toBeGreaterThan(2000);
    expect(herbCss).toContain(':root[data-theme="herbarium"]');
    expect(herbCss).not.toMatch(/animation|@keyframes|transition/);
    expect(THEMES.herbarium.motion).toBeFalsy();
  });

  it("keeps the label's text readable", () => {
    const panel = token("--panel");
    for (const ink of ["--ink", "--ink-2", "--muted", "--accent"]) expect(contrast(token(ink), panel), ink).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--on-accent"), token("--accent"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--muted"), token("--page"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the pressed specimens at sea", () => {
  for (const file of ["world-110m.json", "world-50m.json"]) {
    it(`keeps every spot's whole circle off land (${file})`, () => {
      const l = land(file);
      for (const s of SPECIMENS) {
        for (const p of ring(s.lon, s.lat, s.r)) expect(geoContains(l, p), `${s.kind} at ${s.lat},${s.lon}`).toBe(false);
      }
    }, 60_000);
  }

  it("keeps every spot at least 3 degrees clear of every place", () => {
    const all = places();
    expect(all.length).toBeGreaterThan(50);
    for (const s of SPECIMENS) {
      const nearest = Math.min(...all.map((p) => geoDistance(p, [s.lon, s.lat]) / RAD));
      expect(nearest - s.r, `${s.kind} at ${s.lat},${s.lon}`).toBeGreaterThan(3);
    }
  });

  it("never lets two specimens overlap", () => {
    for (const [i, a] of SPECIMENS.entries()) {
      for (const b of SPECIMENS.slice(i + 1)) expect(geoDistance([a.lon, a.lat], [b.lon, b.lat]) / RAD).toBeGreaterThan(a.r + b.r);
    }
  });
});

describe("the pressed foliage", () => {
  it("lays the same leaf in the same cell every time, inside its cell", () => {
    for (const step of [0.25, 1, 4]) {
      for (const [i, j] of [
        [0, 0],
        [17, 40],
        [300, 12],
      ] as const) {
        const a = leafAt(step, i, j), b = leafAt(step, i, j);
        expect(a).toEqual(b);
        expect(a.lon).toBeGreaterThanOrEqual(i * step - 180);
        expect(a.lon).toBeLessThanOrEqual((i + 1) * step - 180);
        expect(a.lat).toBeGreaterThanOrEqual(j * step - 90);
        expect(a.lat).toBeLessThanOrEqual((j + 1) * step - 90);
      }
    }
  });

  it("picks a grid that keeps leaves a few pixels long at every zoom, finer as the map grows", () => {
    let last = Infinity;
    for (let pxDeg = 1; pxDeg < 2000; pxDeg *= 1.3) {
      const step = leafStep(pxDeg, 14);
      expect(step).toBeLessThanOrEqual(last);
      expect(Math.abs(180 / step - Math.round(180 / step)), `${step}`).toBeLessThan(1e-9);
      last = step;
    }
    expect(leafStep(5, 14) * 5).toBeGreaterThanOrEqual(14);
  });

  it("colours a leaf from its latitude, relief and ice only, the same in both hemispheres", () => {
    for (let k = 0; k < 400; k++) {
      const lat = (k * 37) % 90, h1 = (k * 0.618) % 1, h2 = (k * 0.414) % 1;
      expect(leafTone(lat, h1, h2, false, false)).toBe(leafTone(-lat, h1, h2, false, false));
      expect(leafTone(lat, h1, h2, false, true)).toBe("bleached");
      expect(Object.keys(TONES)).toContain(leafTone(lat, h1, h2, true, false));
    }
  });

  it("blends neighbouring bands over about ten degrees, never further", () => {
    for (const [b, band] of BANDS.entries()) {
      const tones = new Set(band.mix.map(([t]) => t));
      const lo = b === 0 ? 0 : BANDS[b - 1]!.to + BLEND / 2;
      const hi = Math.min(90, band.to - BLEND / 2);
      for (let lat = lo; lat < hi; lat += 0.5) {
        for (let h = 0; h < 1; h += 0.05) expect(tones.has(leafTone(lat, h, h, false, false)), `${lat}`).toBe(true);
      }
    }
  });
});

describe("the globe on its mount", () => {
  it("lays specimens on the sheet clear of the ball, the frame's edge, the Key, the zoom buttons and each other", () => {
    let placed = 0;
    for (const [w, h] of FRAMES) {
      for (const zoom of [1, 1.3, 1.8, 2.5]) {
        const baseR = Math.min(w, h) * (THEMES.herbarium.globeScale ?? 0.46);
        const R = baseR * zoom;
        const cx = w / 2, cy = h / 2;
        const list = placeAround(w, h, cx, cy, R, baseR);
        expect(placeAround(w, h, cx, cy, R, baseR)).toEqual(list);
        for (const s of list) {
          const at = `${w}x${h} zoom ${zoom}: ${s.kind}`;
          expect(Math.hypot(s.x - cx, s.y - cy) - s.s, at).toBeGreaterThan(mountRadius(R));
          expect(s.x - s.s, at).toBeGreaterThan(0);
          expect(s.y - s.s, at).toBeGreaterThan(0);
          expect(s.x + s.s, at).toBeLessThan(w);
          expect(s.y + s.s, at).toBeLessThan(h);
          expect(s.x - s.s > KEY_BOX.w || s.y - s.s > KEY_BOX.h, at).toBe(true);
          expect(s.x + s.s < w - ZOOM_BOX.w || s.y + s.s < h - ZOOM_BOX.h, at).toBe(true);
          for (const o of list) if (o !== s) expect(Math.hypot(o.x - s.x, o.y - s.y), at).toBeGreaterThan(o.s + s.s);
        }
        placed += list.length;
      }
    }
    // On the usual frames at the widest zoom there is room for some.
    expect(placeAround(1000, 645, 500, 322, 645 * 0.38, 645 * 0.38).length).toBeGreaterThanOrEqual(2);
    expect(placed).toBeGreaterThan(10);
  });

  it("tapes the mount down only outside the ball and away from the buttons", () => {
    for (const [w, h] of FRAMES) {
      for (const zoom of [1, 1.5, 2.5]) {
        const baseR = Math.min(w, h) * (THEMES.herbarium.globeScale ?? 0.46);
        const R = baseR * zoom;
        const around = placeAround(w, h, w / 2, h / 2, R, baseR);
        for (const t of mountTapes(w, h, w / 2, h / 2, R, around)) {
          const reach = Math.hypot(t.len, t.wid) / 2;
          expect(Math.hypot(t.x - w / 2, t.y - h / 2) - reach).toBeGreaterThan(R);
          expect(t.x + reach < KEY_BOX.w + 1 && t.y + reach < KEY_BOX.h + 1).toBe(false);
        }
      }
    }
  });
});
