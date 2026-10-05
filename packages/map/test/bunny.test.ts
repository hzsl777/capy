// Bunny (src/map/bunny.ts): every picture sits off the map (outside the globe's opening, outside the window), the same
// for the same frame, clear of the Key and the zoom buttons; the one bunny that moves hops at a gentle rate, ducks into a
// hole while the map moves, comes out and sits under the reticle once it rests, and holds still for reduced motion; the
// land is never red; the design is experimental only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { markPath, markRing } from "../src/map/marks.ts";
import {
  AIR,
  bitsOf,
  bunnyClear,
  cloverAt,
  cloverStep,
  Hopper,
  HOP_LEN,
  HOP_S,
  HOP_UP,
  HOLE,
  holesOf,
  hillOf,
  inWindow,
  KEY_BOX,
  lawnOf,
  MEADOW,
  rectCircleGap,
  SETTLE_MS,
  windowOf,
  ZOOM_BOX,
  type Circle,
} from "../src/map/bunny.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const source = readFileSync(here("../src/map/bunny.ts"), "utf8");
const css = readFileSync(here("../src/style.css"), "utf8");

/** Frame sizes the map area takes on a desktop, a laptop, a tablet and a phone (with and without the word's panel). */
const FRAMES: [number, number][] = [
  [1000, 657],
  [1400, 700],
  [760, 520],
  [390, 330],
  [390, 520],
  [390, 200],
  [320, 280],
];

/** The globe's frame as the view makes it: centred, a radius of `globeScale` of the shorter side times the zoom. */
function globeAt(w: number, h: number, zoom: number): { cx: number; cy: number; R: number; ring: Circle } {
  const R = Math.min(w, h) * (THEMES.bunny.globeScale ?? 0.46) * zoom;
  return { cx: w / 2, cy: h / 2, R, ring: { x: w / 2, y: h / 2, r: R * (HOLE + 0.18) } };
}

describe("bunny: pictures stay off the globe and the map", () => {
  it("keeps every picture clear of the globe's opening, the frame's edge, the Key and the zoom buttons, at every zoom", () => {
    for (const [w, h] of FRAMES) {
      for (const zoom of [1, 1.4, 2, 3.5]) {
        const { cx, cy, R, ring } = globeAt(w, h, zoom);
        const hill = hillOf(w, h, cx, cy, R);
        for (const b of bitsOf(w, h, ring, hill.at)) {
          expect(Math.hypot(b.x - cx, b.y - cy), `${w}x${h} z${zoom} ${b.kind}`).toBeGreaterThan(R + b.r);
          expect(b.x - b.r).toBeGreaterThanOrEqual(2);
          expect(b.x + b.r).toBeLessThanOrEqual(w - 2);
          expect(b.y).toBeLessThanOrEqual(h);
          const inKey = b.x - b.r < KEY_BOX.w && b.y - b.r < KEY_BOX.h;
          const inZoom = b.x + b.r > w - ZOOM_BOX.w && b.y + b.r > h - ZOOM_BOX.h;
          expect(inKey || inZoom, `${w}x${h} ${b.kind} at ${Math.round(b.x)},${Math.round(b.y)}`).toBe(false);
        }
      }
    }
  });

  it("puts the flank pictures on the hill, below its crest and above the lawn, never in the sky", () => {
    for (const [w, h] of FRAMES) {
      const { cx, cy, R, ring } = globeAt(w, h, 1);
      const hill = hillOf(w, h, cx, cy, R);
      const L = lawnOf(w, h);
      for (const b of bitsOf(w, h, ring, hill.at).filter((q) => q.y < L.top)) {
        expect(b.y - b.r).toBeGreaterThanOrEqual(hill.at(b.x));
        expect(b.y).toBeLessThan(L.top);
      }
    }
  });

  it("keeps the lawn's pictures below the window in Map view", () => {
    for (const [w, h] of FRAMES) {
      const win = windowOf(w, h).box;
      for (const b of bitsOf(w, h, null)) expect(b.y - b.r * 0.8).toBeGreaterThanOrEqual(win.y1 - 2);
    }
  });

  it("gives the same pictures to the same frame, and none overlap", () => {
    for (const [w, h] of FRAMES) {
      const a = bitsOf(w, h, null);
      expect(a).toEqual(bitsOf(w, h, null));
      for (const [i, p] of a.entries()) for (const q of a.slice(i + 1)) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan((p.r + q.r) * 0.7);
    }
  });

  it("keeps the holes in the frame, off the zoom buttons and outside the opening", () => {
    for (const [w, h] of FRAMES) {
      for (const zoom of [1, 2]) {
        const { ring } = globeAt(w, h, zoom);
        const L = lawnOf(w, h);
        const { inner, outer } = holesOf(w, h, ring);
        for (const x of [...inner, ...outer]) {
          expect(x - L.unit * 0.8).toBeGreaterThanOrEqual(4);
          expect(x + L.unit * 0.8).toBeLessThanOrEqual(w - 4);
          expect(Math.hypot(x - ring.x, L.base - ring.y)).toBeGreaterThan(ring.r);
          expect(x + L.unit * 0.8 > w - ZOOM_BOX.w && L.base > h - ZOOM_BOX.h).toBe(false);
        }
      }
    }
  });

  it("shows the bunny under the reticle at the usual zoom and leaves it out once the opening has grown over its place", () => {
    for (const [w, h] of FRAMES.filter(([fw, fh]) => fw >= 760 || fh >= 330)) {
      const L = lawnOf(w, h);
      const at = (zoom: number) => {
        const { cx, cy, R } = globeAt(w, h, zoom);
        return bunnyClear(cx, L, { x: cx, y: cy, r: R * HOLE });
      };
      expect(at(1), `${w}x${h}`).toBe(true);
      expect(at(3.5)).toBe(false);
    }
    expect(rectCircleGap({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x: 20, y: 5, r: 4 })).toBeCloseTo(6);
    expect(rectCircleGap({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x: 5, y: 5, r: 4 })).toBeLessThan(0);
  });

  it("makes the window an arch whose corners are cut: its middle is in, its corners and the lawn are out", () => {
    for (const [w, h] of FRAMES) {
      const W = windowOf(w, h);
      expect(W.box.y1).toBe(lawnOf(w, h).top);
      expect(inWindow(w, h, w / 2, (W.box.y0 + W.box.y1) / 2)).toBe(true);
      expect(inWindow(w, h, W.box.x0 + 2, W.box.y0 + 2)).toBe(false);
      expect(inWindow(w, h, w / 2, W.box.y1 + 3)).toBe(false);
      expect(inWindow(w, h, w / 2, W.box.y0 - 3)).toBe(false);
    }
  });
});

describe("bunny: the bunny that hops", () => {
  const W = 1000;
  const unit = 40;
  const holes = [300, 700];
  const home = 500;

  /** Runs the hopper for `seconds` at a frame every 66 ms, the view held at `view`. */
  function run(h: Hopper, from: number, seconds: number, view: (t: number) => string) {
    const poses = [];
    for (let t = from; t <= from + seconds * 1000; t += 66) poses.push({ t, ...h.step(t, view(t), home, holes, unit, false) });
    return poses;
  }

  it("sits at home from the start and asks for no frames while nothing moves", () => {
    const h = new Hopper();
    const poses = run(h, 0, 5, () => "v1");
    expect(poses.every((p) => p.x === home && p.e === 1 && p.lift === 0 && !p.busy && !p.away)).toBe(true);
  });

  it("holds still for reduced motion: at home, whatever the view does", () => {
    const h = new Hopper();
    for (let t = 0; t < 4000; t += 66) {
      const p = h.step(t, `v${t}`, home, holes, unit, true);
      expect(p).toMatchObject({ x: home, lift: 0, e: 1, busy: false });
    }
  });

  it("hops away to a hole while the map moves and ducks in, then comes out and sits at home once it rests", () => {
    const h = new Hopper();
    run(h, 0, 1, () => "rest");
    const moving = run(h, 1000, 8, (t) => `v${Math.floor(t / 66)}`);
    const gone = moving.at(-1)!;
    expect(holes).toContain(gone.x);
    expect(gone.e).toBe(0);
    expect(moving.some((p) => p.away)).toBe(true);
    const back = run(h, 9000, 8, () => "rest2");
    const last = back.at(-1)!;
    expect(last).toMatchObject({ x: home, e: 1, lift: 0, busy: false, away: false });
    // It waited for the map to rest before coming out.
    const firstOut = back.find((p) => p.e > 0 && p.e < 1)!;
    expect(firstOut.t - 9000).toBeGreaterThanOrEqual(SETTLE_MS - 70);
  });

  it("stays on the lawn and hops no more than three times a second", () => {
    const h = new Hopper();
    run(h, 0, 1, () => "rest");
    const poses = [...run(h, 1000, 6, (t) => `v${Math.floor(t / 66)}`), ...run(h, 7000, 8, () => "rest2")];
    let takeoffs = 0;
    let prev = 0;
    const times: number[] = [];
    for (const p of poses) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(W);
      expect(p.lift).toBeLessThanOrEqual(HOP_UP * unit + 0.001);
      if (p.lift > 0 && prev === 0) {
        takeoffs++;
        times.push(p.t);
      }
      prev = p.lift;
    }
    expect(takeoffs).toBeGreaterThan(3);
    for (let i = 3; i < times.length; i++) expect(times[i]! - times[i - 3]!).toBeGreaterThanOrEqual(1000 - 70);
    expect(1 / HOP_S).toBeLessThanOrEqual(3);
    expect(AIR).toBeLessThan(1);
  });

  it("makes the same moves for the same times", () => {
    const go = () => {
      const h = new Hopper();
      return [...run(h, 0, 1, () => "a"), ...run(h, 1000, 4, (t) => `v${Math.floor(t / 66)}`), ...run(h, 5000, 5, () => "b")];
    };
    expect(go()).toEqual(go());
  });

  it("never jumps after a hidden tab: a long gap is a short step", () => {
    const h = new Hopper();
    run(h, 0, 1, () => "a");
    h.step(1100, "b", home, holes, unit, false);
    const after = h.step(600000, "b", home, holes, unit, false);
    expect(Math.abs(after.x - holes[0]!)).toBeLessThanOrEqual(HOP_LEN * unit * 1.01 + Math.abs(home - holes[0]!));
    expect(after.lift).toBeLessThanOrEqual(HOP_UP * unit + 0.001);
  });

  it("asks for frames about fifteen times a second at most", () => {
    expect(source).toMatch(/\? 66 : 0/);
    expect(1000 / 66).toBeLessThan(20);
  });
});

describe("bunny: the world and the design", () => {
  const t = THEMES.bunny;
  const red = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return n >> 16 > ((n >> 8) & 255) + 20;
  };

  it("is experimental only", () => {
    expect(t.experimental).toBe(true);
    expect(t.surface).toBe("bunny");
    expect(DESIGN_GROUPS.flatMap((g) => g.ids)).not.toContain("bunny");
    expect(FEATURED).not.toContain("bunny");
  });

  it("never colours land red: land, ice and the meadow are green or white", () => {
    expect(red(t.land)).toBe(false);
    expect(red(MEADOW)).toBe(false);
    expect(red(t.ice)).toBe(false);
  });

  it("marks places with a carrot, one closed outline unlike a circle, with fresh in another colour", () => {
    expect(t.dotShape).toBe("carrot");
    const d = markPath("carrot", 6);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d).not.toBe(markPath("circle", 6));
    expect(markRing("carrot", 6, 2.6)).toBe(markPath("carrot", 8.6));
    const nums = (d.match(/-?\d+\.?\d*/g) ?? []).map(Number);
    expect(Math.max(...nums.map(Math.abs))).toBeLessThanOrEqual(12);
    expect(t.fresh).not.toBe(t.dot);
  });

  it("ties the clover to the world and keeps each in its own cell", () => {
    expect(cloverAt(2, 40, 17)).toEqual(cloverAt(2, 40, 17));
    expect(cloverAt(2, 40, 17)).not.toEqual(cloverAt(2, 41, 17));
    for (const step of [0.5, 2, 6]) {
      for (let i = 0; i < 30; i++) {
        for (let j = 0; j < 20; j++) {
          const c = cloverAt(step, i, j);
          expect(Math.abs(c.lon - (i + 0.5) * step + 180)).toBeLessThanOrEqual(step * 0.41);
          expect(Math.abs(c.lat - (j + 0.5) * step + 90)).toBeLessThanOrEqual(step * 0.41);
        }
      }
    }
    for (const pxDeg of [0.5, 1, 3, 10, 80, 400]) expect(360 / cloverStep(pxDeg)).toBe(Math.round(360 / cloverStep(pxDeg)));
  });

  it("draws no text, no rivers and no borders, and uses no em dash in its files", () => {
    expect(source).not.toMatch(/fillText|strokeText/);
    expect(source).not.toMatch(/\.rivers|admin_|boundary/);
    expect(source).not.toContain("—");
    const start = css.indexOf('data-theme="bunny"');
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start)).not.toContain("—");
  });

  it("gives the bunny's motion no timer of its own: only the view's frames and the time it is given", () => {
    expect(source).not.toMatch(/requestAnimationFrame|setInterval|setTimeout|Date\.now|performance\.now/);
  });
});
