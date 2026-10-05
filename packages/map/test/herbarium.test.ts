// Garden (id herbarium, src/map/herbarium.ts): the spots at sea sit in tested open water clear of every place, the
// things laid in the globe's sky keep off the ball, the Key and the zoom buttons, the meadow's greens and flowers come
// from latitude, relief and ice only and never make a red land, and what moves stays inside its own circle, at a
// gentle rate, without a flash.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { geoDistance } from "d3-geo";
import type { Position } from "geojson";
import { describe, expect, it } from "vitest";
import {
  BANDS,
  BLEND,
  beeAt,
  bandOf,
  cellAt,
  dragonAt,
  featureAt,
  flap,
  FLAP_HZ,
  floraAt,
  flutterAt,
  FRAME_MS,
  GROUND,
  groundAt,
  gridStep,
  haloRadius,
  isReddish,
  KEY_BOX,
  MAX_AROUND,
  PALETTES,
  petalAt,
  placeAround,
  SPOT_FILL,
  SPOTS,
  starsFor,
  sway,
  twinkle,
  ZOOM_BOX,
  type FloraKind,
} from "../src/map/herbarium.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";
import { samplePlaces } from "./sample.ts";
import { BASEMAPS, inLand, landOf } from "./basemaps.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RAD = Math.PI / 180;
const FILES = BASEMAPS;
const css = readFileSync(here("../src/style.css"), "utf8");
const start = css.indexOf("---- Garden (id herbarium");
const next = css.indexOf("\n/* ---- ", start + 10);
const gardenCss = css.slice(start, next < 0 ? undefined : next);
const source = readFileSync(here("../src/map/herbarium.ts"), "utf8");

const land = landOf;

/** Every coastline of both basemaps as points at most a quarter of a degree apart, so no stretch of coast is missed. */
function coastPoints(): [number, number][] {
  const out: [number, number][] = [];
  const ring = (r: Position[]) => {
    for (let i = 0; i + 1 < r.length; i++) {
      const [ax, ay] = r[i]!;
      const [bx, by] = r[i + 1]!;
      // An edge along the 180th meridian's cut is not a coast.
      if (Math.abs(bx! - ax!) > 180) continue;
      const n = Math.max(1, Math.ceil(Math.hypot(bx! - ax!, by! - ay!) / 0.25));
      for (let j = 0; j < n; j++) out.push([ax! + ((bx! - ax!) * j) / n, ay! + ((by! - ay!) * j) / n]);
    }
  };
  for (const file of FILES) {
    for (const f of land(file).features) {
      const g = f.geometry;
      if (g.type === "Polygon") g.coordinates.forEach(ring);
      else if (g.type === "MultiPolygon") g.coordinates.forEach((p) => p.forEach(ring));
    }
  }
  return out;
}

/** Every outlet's city on the world and briefing desks, and every place in the sample day. */
function places(): [number, number][] {
  const yaml = readFileSync(here("../../../config/sources.yaml"), "utf8");
  const out: [number, number][] = [...yaml.matchAll(/lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)/g)].map((m) => [Number(m[2]), Number(m[1])]);
  for (const p of samplePlaces()) out.push([p.lon, p.lat]);
  return out;
}

/** The nearest point within `max` degrees, or `max` if none is closer. */
function nearestWithin(pts: [number, number][], lon: number, lat: number, max: number): number {
  let best = max;
  for (const p of pts) {
    if (Math.abs(p[1] - lat) >= best) continue;
    best = Math.min(best, geoDistance(p, [lon, lat]) / RAD);
  }
  return best;
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
const token = (name: string) => gardenCss.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`))![1]!;

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

describe("Garden", () => {
  it("is in the Design menu, in one group and not featured (decision 134)", () => {
    const t = THEMES.herbarium;
    expect(t.experimental).toBeFalsy();
    expect(t.surface).toBe("herbarium");
    expect(t.label).toBe("Garden");
    expect(DESIGN_GROUPS.filter((g) => g.ids.includes("herbarium"))).toHaveLength(1);
    expect(FEATURED).not.toContain("herbarium");
    expect(t.fresh).not.toBe(t.dot);
  });

  it("has a stylesheet section of its own, still on the page: all its motion is on the canvas", () => {
    expect(gardenCss.length).toBeGreaterThan(5000);
    expect(gardenCss).toContain(':root[data-theme="herbarium"]');
    expect(gardenCss).not.toMatch(/animation|@keyframes|transition/);
  });

  it("keeps the cards' text readable", () => {
    const panel = token("--panel");
    for (const ink of ["--ink", "--ink-2", "--muted", "--accent"]) expect(contrast(token(ink), panel), ink).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--on-accent"), token("--accent"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--muted"), token("--page"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--ink"), token("--page"))).toBeGreaterThanOrEqual(7);
  });

  it("names nothing it borrows from and draws no text on the canvas", () => {
    expect(source).not.toMatch(/fillText|strokeText/);
    expect(source + gardenCss).not.toMatch(/\u2014/);
  });
});

describe("the spots at sea", () => {
  const all = places();
  const coast = coastPoints();
  const lands = FILES.map(land);

  it("reads the outlet list and the coasts", () => {
    expect(all.length).toBeGreaterThan(50);
    expect(coast.length).toBeGreaterThan(10_000);
    for (const l of lands) expect(inLand(l, [36.82, -1.29])).toBe(true);
  });

  it("has a dozen or more spots, each a known kind, the ladybird's among the largest", () => {
    expect(SPOTS.length).toBeGreaterThanOrEqual(12);
    const kinds = new Set(SPOTS.map((s) => s.kind));
    for (const k of ["rabbit", "hedgehog", "snail", "songbird", "ladybird", "butterflies", "bees", "pond"]) expect(kinds.has(k), k).toBe(true);
    const ladybird = SPOTS.find((s) => s.kind === "ladybird")!;
    expect(ladybird.r).toBeGreaterThanOrEqual(14);
  });

  it("keeps every spot's whole circle off land and off every coast, in both basemaps", () => {
    for (const s of SPOTS) {
      const at = `${s.kind} at ${s.lat},${s.lon}`;
      for (const l of lands) expect(inLand(l, [s.lon, s.lat]), at).toBe(false);
      expect(nearestWithin(coast, s.lon, s.lat, s.r + 1), at).toBeGreaterThan(s.r);
    }
  }, 60_000);

  it("keeps every spot at least 3 degrees beyond its circle from every place", () => {
    for (const s of SPOTS) {
      const nearest = Math.min(...all.map((p) => geoDistance(p, [s.lon, s.lat]) / RAD));
      expect(nearest - s.r, `${s.kind} at ${s.lat},${s.lon}`).toBeGreaterThan(3);
    }
  });

  it("never lets two spots overlap", () => {
    for (const [i, a] of SPOTS.entries()) {
      for (const b of SPOTS.slice(i + 1)) expect(geoDistance([a.lon, a.lat], [b.lon, b.lat]) / RAD, `${a.kind} and ${b.kind}`).toBeGreaterThan(a.r + b.r);
    }
  });
});

describe("the meadow", () => {
  it("lays the same cell in the same place every time, inside its own cell of the world", () => {
    for (const step of [0.25, 1, 4, 18]) {
      for (const salt of [0, 5, 23]) {
        for (const [i, j] of [
          [0, 0],
          [17, 4],
          [20, 9],
        ] as const) {
          const a = cellAt(step, i, j, salt), b = cellAt(step, i, j, salt);
          expect(a).toEqual(b);
          expect(a.lon).toBeGreaterThanOrEqual(i * step - 180);
          expect(a.lon).toBeLessThanOrEqual((i + 1) * step - 180);
          expect(a.lat).toBeGreaterThanOrEqual(j * step - 90);
          expect(a.lat).toBeLessThanOrEqual((j + 1) * step - 90);
        }
      }
    }
    expect(cellAt(2, 40, 17)).not.toEqual(cellAt(2, 41, 17));
  });

  it("picks a grid that divides the world and keeps cells about the same size on screen, finer as the map grows", () => {
    let last = Infinity;
    for (let pxDeg = 0.5; pxDeg < 4000; pxDeg *= 1.3) {
      const step = gridStep(pxDeg, 15);
      expect(step).toBeLessThanOrEqual(last);
      expect(Math.abs(180 / step - Math.round(180 / step)), `${step}`).toBeLessThan(1e-9);
      last = step;
    }
    expect(gridStep(5, 15) * 5).toBeGreaterThanOrEqual(15);
  });

  it("gives every band's shares that add up to one, and greens that are never red", () => {
    for (const b of BANDS) {
      for (const mix of [b.ground, b.flora, b.feature]) expect(mix.reduce((a, [, s]) => a + s, 0), `band to ${b.to}`).toBeCloseTo(1, 6);
    }
    for (const [name, hex] of Object.entries(GROUND)) {
      const n = parseInt(hex.slice(1), 16);
      const r = n >> 16, g = (n >> 8) & 255, bl = n & 255;
      expect(g, name).toBeGreaterThanOrEqual(r);
      expect(g, name).toBeGreaterThanOrEqual(bl);
      expect(isReddish(hex), name).toBe(false);
    }
    for (const [kind, pal] of Object.entries(PALETTES)) expect(pal.reduce((a, [, s]) => a + s, 0), kind).toBeCloseTo(1, 6);
  });

  it("keeps red-ish flowers few: a sliver of every band's cells and never a share of any region", () => {
    for (const b of BANDS) {
      let red = 0;
      for (const [kind, share] of b.flora) {
        if (kind === "tuft" || kind === "frost") continue;
        for (const [hex, s] of PALETTES[kind]) if (isReddish(hex)) red += share * s;
      }
      expect(red, `band to ${b.to}`).toBeLessThanOrEqual(0.02);
    }
  });

  it("grows sunflowers only in the warm belts and in no cold band", () => {
    const has = (band: (typeof BANDS)[number], kind: FloraKind) => band.flora.some(([k]) => k === kind);
    expect(has(BANDS[1]!, "sunflower")).toBe(true);
    expect(has(BANDS[3]!, "sunflower")).toBe(false);
    expect(has(BANDS[4]!, "sunflower")).toBe(false);
  });

  it("chooses ground, flowers and features from latitude, relief and ice only, the same in both hemispheres", () => {
    for (let k = 0; k < 400; k++) {
      const lat = (k * 37) % 90, h1 = (k * 0.618) % 1, h2 = (k * 0.414) % 1;
      expect(groundAt(lat, h1, h2, false, false)).toBe(groundAt(-lat, h1, h2, false, false));
      expect(floraAt(lat, h1, h2, false, false)).toBe(floraAt(-lat, h1, h2, false, false));
      expect(featureAt(lat, h1, h2, false, false)).toBe(featureAt(-lat, h1, h2, false, false));
      expect(["snow", "frost"]).toContain(groundAt(lat, h1, h2, false, true));
      expect(floraAt(lat, h1, h2, false, true)).toBe("frost");
      expect(["moss", "hill", "clover"]).toContain(groundAt(lat, h1, h2, true, false));
    }
  });

  it("blends neighbouring bands over about ten degrees, never further", () => {
    for (const [b, band] of BANDS.entries()) {
      const greens = new Set(band.ground.map(([g]) => g));
      const lo = b === 0 ? 0 : BANDS[b - 1]!.to + BLEND / 2;
      const hi = Math.min(90, band.to - BLEND / 2);
      for (let lat = lo; lat < hi; lat += 0.5) {
        for (let h = 0; h < 1; h += 0.05) {
          expect(bandOf(lat, h), `${lat}`).toBe(band);
          expect(greens.has(groundAt(lat, h, h, false, false)), `${lat}`).toBe(true);
        }
      }
    }
  });
});

describe("the globe's sky", () => {
  const baseOf = (w: number, h: number) => Math.min(w, h) * (THEMES.herbarium.globeScale ?? 0.46);

  it("lays things in the sky clear of the halo, the frame's edge, the Key, the zoom buttons and each other", () => {
    let placed = 0;
    for (const [w, h] of FRAMES) {
      for (const zoom of [1, 1.3, 1.8, 2.5]) {
        const baseR = baseOf(w, h);
        const R = baseR * zoom;
        const cx = w / 2, cy = h / 2;
        const list = placeAround(w, h, cx, cy, R, baseR);
        expect(placeAround(w, h, cx, cy, R, baseR)).toEqual(list);
        expect(list.length).toBeLessThanOrEqual(MAX_AROUND);
        for (const s of list) {
          const at = `${w}x${h} zoom ${zoom}: ${s.kind}`;
          expect(Math.hypot(s.x - cx, s.y - cy) - s.s, at).toBeGreaterThan(haloRadius(R));
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
    // On the usual frames at the widest zoom there is room for several, and on a tiny one for none.
    expect(placeAround(1000, 645, 500, 322, baseOf(1000, 645), baseOf(1000, 645)).length).toBeGreaterThanOrEqual(3);
    expect(placed).toBeGreaterThan(20);
    expect(placeAround(120, 90, 60, 45, 36, 36)).toEqual([]);
  });

  it("keeps the stars off the halo, the things in the sky and the buttons", () => {
    for (const [w, h] of FRAMES) {
      const baseR = baseOf(w, h);
      const R = baseR * 1.3;
      const around = placeAround(w, h, w / 2, h / 2, R, baseR);
      for (const s of starsFor(w, h, w / 2, h / 2, R, around)) {
        expect(Math.hypot(s.x - w / 2, s.y - h / 2) - s.r).toBeGreaterThan(haloRadius(R));
        expect(s.x - s.r > KEY_BOX.w || s.y - s.r > KEY_BOX.h).toBe(true);
        expect(s.x + s.r < w - ZOOM_BOX.w || s.y + s.r < h - ZOOM_BOX.h).toBe(true);
        for (const o of around) expect(Math.hypot(o.x - s.x, o.y - s.y)).toBeGreaterThan(o.s + s.r);
      }
    }
  });
});

describe("what moves", () => {
  const ts = Array.from({ length: 1200 }, (_, i) => i * 0.5);

  it("stays inside its spot's circle, glyph and all", () => {
    for (const t of ts) {
      for (const k of [0, 1, 2, 3, 4, 5, 6]) {
        const f = flutterAt(t, k), p = petalAt(t, k), b = beeAt(t, k), d = dragonAt(t, k);
        // The butterfly is drawn about 0.24 across from its centre, a petal 0.07, a bee 0.1, a dragonfly 0.3.
        expect(Math.hypot(f.x, f.y) + 0.24).toBeLessThan(0.95);
        expect(Math.hypot(p.x, p.y) + 0.07).toBeLessThan(0.95);
        expect(Math.hypot(b.x, b.y) + 0.1).toBeLessThan(0.95);
        expect(Math.hypot(d.x, d.y) + 0.3).toBeLessThan(0.95);
      }
    }
    expect(SPOT_FILL).toBeLessThanOrEqual(0.8);
  });

  it("moves at a gentle rate, never in the sea's light: about eleven frames a second, wings under three beats", () => {
    expect(FRAME_MS).toBeGreaterThanOrEqual(80);
    expect(FRAME_MS).toBeLessThanOrEqual(125);
    expect(FLAP_HZ).toBeLessThan(3);
    for (let t = 0; t < 20; t += 0.01) {
      expect(flap(t)).toBeGreaterThanOrEqual(0.3);
      expect(flap(t)).toBeLessThanOrEqual(1);
    }
  });

  it("sways the giant flowers by a few hundredths of a turn at most", () => {
    for (const t of ts) for (const p of [0, 1, 2, 3.7]) expect(Math.abs(sway(t, p))).toBeLessThanOrEqual(0.05);
  });

  it("twinkles the stars slowly: no 10% swing in brightness within a third of a second", () => {
    let hi = 0;
    for (const phase of [0, 1.7, 3.4, 5.1]) {
      for (let t = 0; t < 40; t += 1 / 60) hi = Math.max(hi, Math.abs(twinkle(t + 1 / 3, phase) - twinkle(t, phase)));
    }
    expect(hi).toBeLessThan(0.1);
    expect(twinkle(0, 0)).toBeGreaterThan(0.5);
  });

  it("holds still for reduced motion and in a hidden tab, because it asks the view for frames the view holds", () => {
    expect(source).toContain("stillMotion()");
    expect(source).toContain("motionTime()");
    expect(source).not.toMatch(/requestAnimationFrame|setInterval|setTimeout/);
  });
});
