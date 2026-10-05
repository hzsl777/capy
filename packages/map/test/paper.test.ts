// Notebook (src/map/paper.ts, src/ui/paper.ts): a design in the menu (decision 134). Its colours are
// the notebook's and are the same on the canvas and in the stylesheet; the pen's wobble is the same for the same place
// on the world, small, and never folds a shape over; every frame is the whole picture, whether or not the map moves;
// the page turn swings the page without changing any colour, in under a third of a second; and the pages' parts show
// in this design only.
import { geoNaturalEarth1 } from "d3-geo";
import { describe, expect, it } from "vitest";
import {
  BLACK,
  DESK,
  drawPaper,
  FLIP_MAX,
  FLIP_MS,
  flipAngle,
  flipFrames,
  GRAPHITE,
  handCircle,
  HIGHLIGHT,
  INK,
  luminance,
  MARGIN,
  PAPER,
  PaperCache,
  penNudge,
  RED,
  RULE,
  WASH,
  WOBBLE_PX,
  wobbleAt,
} from "../src/map/paper.ts";
import type { SurfaceFrame } from "../src/map/surface.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";
import { cssFor } from "./css.ts";

const css = cssFor("paper").replace(/\/\*[\s\S]*?\*\//g, "");
/** Every rule of the stylesheet that names this design, with its body. */
const paperRules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! })).filter((r) => r.sel.includes('data-theme="paper"'));

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe("Notebook", () => {
  it("is in the Design menu, in one group and not featured (decision 134)", () => {
    const t = THEMES.paper;
    expect(t.label).toBe("Notebook");
    expect(t.experimental).toBeFalsy();
    expect(DESIGN_GROUPS.filter((g) => g.ids.includes("paper"))).toHaveLength(1);
    expect(FEATURED).not.toContain("paper");
    expect(FEATURED).not.toContain("paper");
    expect(t.surface).toBe("paper");
  });

  it("draws the map and its markers in the notebook's colours", () => {
    const t = THEMES.paper;
    const palette = [PAPER, RULE, MARGIN, INK, BLACK, GRAPHITE, HIGHLIGHT, WASH, RED, DESK];
    const colours = Object.values(t).filter((v): v is string => typeof v === "string" && v.startsWith("#"));
    expect(colours.length).toBeGreaterThan(10);
    for (const c of colours) expect(palette, c).toContain(c);
    // A black pen for the places, blue ink for the world.
    expect(t.dot).toBe(BLACK);
    expect(t.coast).toBe(INK);
    expect(t.land).toBe(PAPER);
  });

  it("repeats those colours in the stylesheet, and uses no others for the page's paper and ink", () => {
    const tokens = paperRules.find((r) => r.sel === ':root[data-theme="paper"]')!.body;
    const named: Record<string, string> = { paper: PAPER, rule: RULE, margin: MARGIN, ink: INK, black: BLACK, graphite: GRAPHITE, highlight: HIGHLIGHT, wash: WASH, red: RED, desk: DESK };
    for (const [name, hex] of Object.entries(named)) expect(tokens, name).toMatch(new RegExp(`--nb-${name}:\\s*${hex};`));
    // The few derived shades: the sticky note, the hover highlight, the primary button's hover, the holes.
    const allowed = new Set([...Object.values(named), "#fff6b8", "#fff7c4", "#2a4cb8", "#364862"]);
    for (const r of paperRules) for (const hex of r.body.match(/#[0-9a-f]{6}\b/gi) ?? []) expect(allowed, `${r.sel}: ${hex}`).toContain(hex.toLowerCase());
  });

  it("keeps its writing readable on the paper", () => {
    expect(contrast(BLACK, PAPER)).toBeGreaterThan(12);
    expect(contrast(INK, PAPER)).toBeGreaterThan(7);
    expect(contrast(GRAPHITE, PAPER)).toBeGreaterThan(7);
    // The red pen, for headings of a group and the fresh marker.
    expect(contrast(RED, PAPER)).toBeGreaterThan(4.5);
    // The rules sit behind the writing, so they are paler than anything written.
    expect(contrast(RULE, PAPER)).toBeLessThan(1.6);
  });

  it("tells fresh reports apart by the red pen, with an outline that shows against the ink", () => {
    const t = THEMES.paper;
    expect(t.fresh).toBe(RED);
    expect(t.fresh).not.toBe(t.dot);
    expect(t.dotStroke).toBe(PAPER);
    expect(t.dotShape).toBe("circle");
  });

  describe("the pen", () => {
    it("strays by the same amount at the same place on the world, however the map was turned to it", () => {
      for (const [lon, lat] of [[0, 0], [36.82, -1.29], [-122.4, 37.8], [179.9, -60]] as const) {
        expect(penNudge(lon, lat)).toEqual(penNudge(lon, lat));
        expect(penNudge(lon, lat, true)).toEqual(penNudge(lon, lat, true));
      }
      expect(penNudge(10, 20, true)).not.toEqual(penNudge(10, 20, false));
    });

    it("stays within a pixel or so of the true line, at any scale", () => {
      let worst = 0;
      for (let lon = -180; lon <= 180; lon += 3.7)
        for (let lat = -85; lat <= 85; lat += 3.1)
          for (const shake of [false, true]) {
            const [x, y] = penNudge(lon, lat, shake);
            worst = Math.max(worst, Math.abs(x), Math.abs(y));
          }
      expect(worst).toBeGreaterThan(0.5);
      expect(worst * WOBBLE_PX).toBeLessThan(1.4);
      for (const scale of [40, 143, 600, 5000]) expect(wobbleAt(scale)).toBeLessThanOrEqual(WOBBLE_PX);
    });

    it("never folds a filled shape over: the drift's slope stays under one at every scale", () => {
      // A shape that is nudged by a field whose slope is under one keeps its orientation, so a tiny lake or island is
      // moved, never turned inside out (which a projection would read as "everything but this lake").
      for (const scale of [40, 55, 90, 143, 300, 1200, 8000]) {
        const deg = 1 / (scale * (Math.PI / 180)); // degrees in one pixel
        const px = wobbleAt(scale);
        let worst = 0;
        for (let lon = -170; lon <= 170; lon += 17)
          for (let lat = -80; lat <= 80; lat += 13) {
            const a = penNudge(lon, lat);
            const dx = penNudge(lon + deg, lat);
            const dy = penNudge(lon, lat + deg);
            // The displacement's Jacobian, in pixels per pixel.
            const j = [(dx[0] - a[0]) * px, (dy[0] - a[0]) * px, (dx[1] - a[1]) * px, (dy[1] - a[1]) * px];
            worst = Math.max(worst, Math.hypot(...j));
          }
        expect(worst, `scale ${scale}`).toBeLessThan(0.9);
      }
    });

    it("draws a hand circle that wanders a little round its radius and overshoots where it meets itself", () => {
      const moves: [string, number, number][] = [];
      const orig = (globalThis as { Path2D?: unknown }).Path2D;
      (globalThis as { Path2D?: unknown }).Path2D = class {
        moveTo(x: number, y: number) {
          moves.push(["m", x, y]);
        }
        lineTo(x: number, y: number) {
          moves.push(["l", x, y]);
        }
      };
      try {
        handCircle(100, 100, 50, 1.1);
      } finally {
        (globalThis as { Path2D?: unknown }).Path2D = orig;
      }
      const radii = moves.map(([, x, y]) => Math.hypot(x - 100, y - 100));
      expect(Math.min(...radii)).toBeGreaterThan(48.5);
      expect(Math.max(...radii)).toBeLessThan(53.5);
      // The end passes the start without joining it.
      const first = moves[0]!;
      const last = moves[moves.length - 1]!;
      expect(Math.hypot(first[1] - last[1], first[2] - last[2])).toBeGreaterThan(0.5);
    });
  });

  describe("every frame is the whole picture", () => {
    // A recording canvas and a small map: the same view drawn with the map held still and with it moving must make exactly
    // the same marks, so there is no plain picture while it moves and a fuller one once it stops (the old stutter).
    class FakePath {
      n = 0;
      moveTo() {
        this.n++;
      }
      lineTo() {
        this.n++;
      }
      arc() {
        this.n++;
      }
      closePath() {}
    }
    const square = (lon: number, lat: number, s: number) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [[[lon, lat], [lon + s, lat], [lon + s, lat + s], [lon, lat + s], [lon, lat]]] } });
    const map = {
      land: { type: "FeatureCollection" as const, features: [square(0, 0, 30), square(60, 10, 20), square(-80, -20, 0.2)] },
      coast: { type: "MultiLineString" as const, coordinates: [[[0, 0], [30, 0], [30, 30], [0, 30], [0, 0]]] },
      lakes: { type: "FeatureCollection" as const, features: [square(10, 10, 0.1)] },
      rivers: { type: "FeatureCollection" as const, features: [{ type: "Feature" as const, properties: { r: 1 }, geometry: { type: "LineString" as const, coordinates: [[5, 5], [15, 12], [25, 20]] } }] },
      ice: { type: "FeatureCollection" as const, features: [square(0, 60, 40)] },
    };
    const relief = { peaks: Array.from({ length: 40 }, (_, i) => [i * 2, i] as [number, number]), dunes: [] };

    function run(still: boolean, cache: PaperCache): string[] {
      const calls: string[] = [];
      const orig = (globalThis as { Path2D?: unknown }).Path2D;
      (globalThis as { Path2D?: unknown }).Path2D = FakePath;
      const ctx = new Proxy(
        {},
        {
          get: (_t, name: string) => (...args: unknown[]) => {
            calls.push(`${name}(${args.map((a) => (typeof a === "number" ? a.toFixed(3) : a instanceof FakePath ? `path${a.n}` : String(a))).join(",")})`);
          },
          set: (_t, name: string, v: unknown) => {
            calls.push(`${name}=${String(v)}`);
            return true;
          },
        },
      ) as unknown as CanvasRenderingContext2D;
      const proj = geoNaturalEarth1().scale(143).translate([300, 200]);
      const f = { ctx, w: 600, h: 400, dpr: 1, mode: "2d", proj, view: proj, zoom: 1, lon: 0, lat: 0, map, relief, still } as unknown as SurfaceFrame;
      try {
        drawPaper(f, cache);
      } finally {
        (globalThis as { Path2D?: unknown }).Path2D = orig;
      }
      return calls;
    }

    it("makes the same marks whether or not the map is moving", () => {
      const a = run(false, new PaperCache());
      const b = run(true, new PaperCache());
      expect(a.length).toBeGreaterThan(20);
      expect(a).toEqual(b);
    });

    it("clears nothing and keeps the pen's strokes while the view holds still, so a marker's redraw is only fills", () => {
      const cache = new PaperCache();
      const calls = run(false, cache);
      expect(calls.some((c) => c.startsWith("clearRect"))).toBe(false);
      const strokes = cache.strokes;
      expect(strokes).toBeDefined();
      run(false, cache);
      expect(cache.strokes).toBe(strokes);
    });

    it("leaves the sea clear, so the page's rules run through it: the first thing drawn is not a fill of the whole sheet in paper", () => {
      const calls = run(false, new PaperCache());
      const firstFill = calls.findIndex((c) => c.startsWith("fillStyle="));
      expect(calls[firstFill]).not.toBe(`fillStyle=${PAPER}`);
    });
  });

  describe("the page turn", () => {
    it("swings the page on its binding in under a third of a second, without leaving the page", () => {
      expect(FLIP_MS).toBeLessThan(1000 / 3);
      expect(flipAngle(0)).toBeCloseTo(0, 9);
      expect(flipAngle(1)).toBeCloseTo(0, 9);
      for (let i = 0; i <= 200; i++) expect(Math.abs(flipAngle(i / 200))).toBeLessThanOrEqual(FLIP_MAX + 1e-9);
      expect(FLIP_MAX).toBeLessThan(90);
      // At the middle, where the new page takes the old one's place, the page is edge-on on both sides of the swap.
      const edgeOn = (deg: number) => Math.abs(Math.cos((deg * Math.PI) / 180));
      expect(edgeOn(flipAngle(0.4999))).toBeLessThan(0.06);
      expect(edgeOn(flipAngle(0.5001))).toBeLessThan(0.06);
    });

    it("changes only the transform, never a colour or the opacity, so there is nothing to flash", () => {
      for (const forward of [true, false]) {
        const frames = flipFrames(forward);
        expect(frames.length).toBeGreaterThan(8);
        for (const fr of frames) expect(Object.keys(fr).sort()).toEqual(["offset", "transform"]);
      }
      // What shows behind a swinging page is the page itself, the same paper with a one pixel pale rule every 28
      // pixels (the sheet is the same paper), so a turn moves the light of the area by a small fraction of a tenth.
      const lineCss = paperRules.find((r) => r.sel === ':root[data-theme="paper"]')!.body.match(/--line:\s*(\d+)px/);
      expect(lineCss).not.toBeNull();
      expect((luminance(PAPER) - luminance(RULE)) / Number(lineCss![1])).toBeLessThan(0.02);
    });
  });

  it("shows the page's foot in this design only", () => {
    const rules = [...css.matchAll(/([^{}]*\.pp-pager(?![\w-])[^{}]*)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
    const base = rules.filter((r) => /^\.pp-pager$/.test(r.sel));
    expect(base).toHaveLength(1);
    expect(base[0]!.body).toMatch(/display:\s*none/);
    for (const r of rules) if (/display:\s*(?!none)\w/.test(r.body)) expect(r.sel, r.sel).toContain(':root[data-theme="paper"]');
  });

  it("has no bezel buttons left over from the old design", () => {
    expect(css).not.toMatch(/\.pp-side/);
  });
});
