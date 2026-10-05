// Burger Joint (src/map/burger.ts, src/ui/burger.ts): the leaf veins are tied to the world's longitude and latitude,
// the stack of layers round the world is built in order from rings that fit their shapes, the tray's bottles keep clear
// of the globe's stack, the map's window, the Key, the zoom buttons and each other, the design is in the menu,
// land is never red, and nothing in it moves.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  boxRing,
  circleRing,
  cornerness,
  dripsOf,
  KEY_BOX,
  LAYERS,
  lettuceWave,
  mapBottles,
  placeBottles,
  REACH,
  ringAt,
  slabOf,
  STACK_REACH,
  veinAt,
  veinStep,
  ZOOM_BOX,
} from "../src/map/burger.ts";
import { markPath } from "../src/map/marks.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";
import { heightOf, stackOf, TOPPINGS } from "../src/ui/burger.ts";
import { FILTERS as WORLD_TOPICS } from "../src/data.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const source = readFileSync(here("../src/map/burger.ts"), "utf8");
const ui = readFileSync(here("../src/ui/burger.ts"), "utf8");
const css = readFileSync(here("../src/style.css"), "utf8");

describe("burger: the lettuce's veins", () => {
  it("gives the same vein to the same cell, always", () => {
    expect(veinAt(2, 40, 17)).toEqual(veinAt(2, 40, 17));
    expect(veinAt(2, 40, 17)).not.toEqual(veinAt(2, 41, 17));
  });

  it("keeps each vein inside its own cell of the world", () => {
    for (const step of [0.5, 2, 6]) {
      for (let i = 0; i < 30; i++) {
        for (let j = 0; j < 20; j++) {
          const v = veinAt(step, i, j);
          expect(Math.abs(v.lon - (i + 0.5) * step + 180)).toBeLessThanOrEqual(step * 0.36);
          expect(Math.abs(v.lat - (j + 0.5) * step + 90)).toBeLessThanOrEqual(step * 0.36);
          expect(v.size).toBeGreaterThan(0.7);
        }
      }
    }
  });

  it("picks a grid step that divides the world and is about a leaf's width on screen", () => {
    for (const pxDeg of [0.5, 1, 3, 10, 80, 400]) {
      const step = veinStep(pxDeg);
      expect(360 / step).toBe(Math.round(360 / step));
      expect(step * pxDeg).toBeGreaterThanOrEqual(Math.min(46, 6 * pxDeg));
    }
  });
});

describe("burger: the stack round the world", () => {
  it("lists the layers from the world outward, each reaching further than the one inside it", () => {
    expect(REACH.map(([k]) => k)).toEqual([...LAYERS]);
    expect(LAYERS).toEqual(["lettuce", "tomato", "cheese", "patty", "bun"]);
    for (let i = 0; i < REACH.length; i++) {
      const [, lo, hi] = REACH[i]!;
      expect(hi).toBeGreaterThan(lo);
      if (i > 0) {
        expect(lo).toBeGreaterThan(REACH[i - 1]![1]);
        expect(hi).toBeGreaterThan(REACH[i - 1]![2]);
      }
    }
    expect(STACK_REACH).toBe(REACH[REACH.length - 1]![2]);
  });

  it("makes a circle ring of unit normals at the circle's radius, running once round", () => {
    const r = circleRing(100, 80, 60, 0.3);
    expect(r.kind).toBe("circle");
    let prev = -1;
    for (const p of r.pts) {
      expect(Math.hypot(p.x - 100, p.y - 80)).toBeCloseTo(60, 6);
      expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1, 6);
      expect(p.u).toBeGreaterThan(prev);
      expect(p.u).toBeLessThan(1);
      prev = p.u;
    }
    expect(r.corners).toHaveLength(4);
  });

  it("makes a box ring that follows the rounded rectangle, with unit normals pointing out", () => {
    const b = { x0: 10, y0: 20, x1: 210, y1: 140 };
    const r = boxRing(b, 18);
    expect(r.kind).toBe("box");
    let prev = -1;
    for (const p of r.pts) {
      expect(p.x).toBeGreaterThanOrEqual(b.x0 - 1e-6);
      expect(p.x).toBeLessThanOrEqual(b.x1 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(b.y0 - 1e-6);
      expect(p.y).toBeLessThanOrEqual(b.y1 + 1e-6);
      expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1, 6);
      // A step along the normal moves away from the middle.
      const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
      expect(Math.hypot(p.x + p.nx - mx, p.y + p.ny - my)).toBeGreaterThan(Math.hypot(p.x - mx, p.y - my) - 1e-6);
      expect(p.u).toBeGreaterThanOrEqual(prev);
      prev = p.u;
    }
    expect(r.corners).toHaveLength(4);
    for (const c of r.corners) expect(c).toBeGreaterThan(0);
    expect(r.length).toBeGreaterThan(2 * (200 + 120) - 4 * 18 * 2 + Math.PI * 18 * 2 - 1);
  });

  it("finds the point of a ring at any u, wrapping", () => {
    const r = circleRing(0, 0, 50);
    const p = ringAt(r, 0.25);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(50, 1);
    const a = ringAt(r, 0.1), b = ringAt(r, 1.1);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });

  it("keeps the lettuce's edge between 0 and 1 and closed", () => {
    for (const n of [8, 15, 40]) {
      for (let i = 0; i <= 200; i++) {
        const w = lettuceWave(i / 200, n);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
      expect(lettuceWave(1, n)).toBeCloseTo(lettuceWave(0, n), 6);
    }
  });

  it("points the cheese's corners out at the ring's corners and hangs its drips near the bottom", () => {
    const c = circleRing(0, 0, 100, 0.2);
    for (const u of c.corners) expect(cornerness(c, u)).toBeCloseTo(1, 6);
    expect(cornerness(c, c.corners[0]! + 0.125)).toBeLessThan(0.05);
    const drips = dripsOf(c);
    expect(drips).toHaveLength(3);
    for (const u of drips) expect(ringAt(c, u).ny).toBeGreaterThan(0.8);
    expect(dripsOf(circleRing(0, 0, 100, 0.2))).toEqual(drips);
  });
});

describe("burger: Map view's tray and stack", () => {
  for (const [w, h] of [[1000, 626], [717, 498], [390, 271], [390, 520], [320, 200]] as const) {
    it(`fits the window inside the stack inside the liner in a ${w} by ${h} frame`, () => {
      const s = slabOf(w, h);
      expect(s.stack.x0).toBeGreaterThan(s.lip);
      expect(s.window.x0).toBeGreaterThan(s.stack.x0);
      expect(s.window.y0).toBeGreaterThan(s.stack.y0);
      expect(s.window.x1).toBeLessThan(s.stack.x1);
      expect(s.window.y1).toBeLessThan(s.stack.y1);
      expect(s.stack.x1).toBeLessThan(w - s.lip);
      expect(s.stack.y1).toBeLessThanOrEqual(h - s.lip);
      expect(s.window.x1 - s.window.x0).toBeGreaterThan(w * 0.6);
      expect(s.window.y1 - s.window.y0).toBeGreaterThan(h * 0.5);
      // The stack's greatest reach just fills the room between the window and the stack's outer edge.
      expect(s.window.x0 - s.stack.x0).toBeCloseTo(STACK_REACH * s.unit, 6);
    });
  }

  it("lays the bottles in the strip under the stack, clear of it, the zoom buttons and each other", () => {
    for (const [w, h] of [[1000, 626], [717, 498], [900, 420], [560, 380]] as const) {
      const s = slabOf(w, h);
      const bottles = mapBottles(w, h);
      expect(bottles.length).toBeGreaterThan(0);
      for (const b of bottles) {
        expect(b.y - b.s * 0.3).toBeGreaterThanOrEqual(s.stack.y1 - 1);
        expect(b.y + b.s * 0.3).toBeLessThanOrEqual(h - s.lip + 1);
        expect(b.x - b.s).toBeGreaterThanOrEqual(0);
        expect(b.x + b.s).toBeLessThan(w - ZOOM_BOX.w);
      }
      for (let i = 0; i < bottles.length; i++) for (let j = i + 1; j < bottles.length; j++) expect(Math.hypot(bottles[i]!.x - bottles[j]!.x, bottles[i]!.y - bottles[j]!.y)).toBeGreaterThan(Math.min(bottles[i]!.s, bottles[j]!.s) * 2 - 1);
    }
  });

  it("has no bottles on a small frame, where there is no strip", () => {
    expect(mapBottles(390, 271)).toEqual([]);
    expect(slabOf(390, 271).strip).toBeNull();
  });
});

describe("burger: the bottles beside the globe", () => {
  const frames: [number, number][] = [[1000, 626], [1400, 900], [390, 271], [390, 520], [717, 498], [320, 200]];
  it("never touch the stack, the Key, the zoom buttons, the frame's edge or each other", () => {
    for (const [w, h] of frames) {
      for (const k of [0.4, 0.6, 0.8, 1]) {
        const R = Math.min(w, h) * 0.34 * k;
        const cx = w / 2, cy = h / 2;
        const bottles = placeBottles(w, h, cx, cy, R, R / k);
        const P = R * (1 + STACK_REACH);
        for (const b of bottles) {
          expect(Math.hypot(b.x - cx, b.y - cy)).toBeGreaterThan(P + b.s);
          expect(b.x - b.s).toBeGreaterThanOrEqual(0);
          expect(b.y - b.s).toBeGreaterThanOrEqual(0);
          expect(b.x + b.s).toBeLessThanOrEqual(w);
          expect(b.y + b.s).toBeLessThanOrEqual(h);
          const nearKey = b.x - b.s < KEY_BOX.w && b.y - b.s < KEY_BOX.h;
          const nearZoom = b.x + b.s > w - ZOOM_BOX.w && b.y + b.s > h - ZOOM_BOX.h;
          expect(nearKey || nearZoom).toBe(false);
        }
        for (let i = 0; i < bottles.length; i++) for (let j = i + 1; j < bottles.length; j++) expect(Math.hypot(bottles[i]!.x - bottles[j]!.x, bottles[i]!.y - bottles[j]!.y)).toBeGreaterThan(bottles[i]!.s + bottles[j]!.s);
      }
    }
  });

  it("are the same every time and at most one of each kind", () => {
    const a = placeBottles(1400, 900, 700, 450, 300, 300);
    expect(placeBottles(1400, 900, 700, 450, 300, 300)).toEqual(a);
    expect(new Set(a.map((t) => t.kind)).size).toBe(a.length);
  });

  it("are left out when the globe fills the frame", () => {
    expect(placeBottles(400, 400, 200, 200, 190, 190)).toEqual([]);
  });
});

describe("burger: the Topics menu's burger", () => {
  it("has a topping for every topic and a layer for every topic that is on, in the topics' order", () => {
    expect(TOPPINGS).toHaveLength(WORLD_TOPICS.length);
    const all = stackOf(WORLD_TOPICS.map(() => true));
    expect(all).toHaveLength(WORLD_TOPICS.length);
    expect(all.map((l) => l.index)).toEqual(WORLD_TOPICS.map((_, i) => i));
    const some = stackOf(WORLD_TOPICS.map((_, i) => i % 3 === 0));
    expect(some.map((l) => l.index)).toEqual([0, 3, 6, 9]);
    for (let i = 1; i < some.length; i++) expect(some[i]!.y - some[i - 1]!.y).toBe(some[1]!.y - some[0]!.y);
    expect(heightOf(some.length)).toBeLessThan(heightOf(all.length));
  });

  it("is only a picture: no timers, no innerHTML", () => {
    expect(ui).not.toMatch(/requestAnimationFrame|setInterval|setTimeout|innerHTML/);
    expect(ui).not.toContain("—");
  });
});

describe("burger: the design", () => {
  const t = THEMES.burger;

  it("is in the Design menu, in one group and not featured (decision 138)", () => {
    expect(t.surface).toBe("burger");
    expect(t.experimental).toBeFalsy();
    expect(DESIGN_GROUPS.filter((g) => g.ids.includes("burger"))).toHaveLength(1);
    expect(FEATURED).not.toContain("burger");
  });

  it("marks places with a sesame seed, pointed at one end, one closed shape, with fresh in another colour", () => {
    expect(t.dotShape).toBe("seed");
    expect(markPath("seed", 6)).not.toBe(markPath("circle", 6));
    expect(markPath("seed", 6)).not.toBe(markPath("bean", 6));
    const d = markPath("seed", 6);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d.match(/M/g)).toHaveLength(1);
    expect(t.fresh).not.toBe(t.dot);
  });

  it("keeps the land green, never red, and lighter than the sea, so the coast is the only edge", () => {
    const rgb = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return [n >> 16, (n >> 8) & 255, n & 255] as const;
    };
    const lum = (hex: string) => {
      const [r, g, b] = rgb(hex);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [r, g] = rgb(t.land);
    expect(g).toBeGreaterThan(r + 30);
    expect(lum(t.land)).toBeGreaterThan(lum(t.ocean) + 30);
    // Not the ice's cream either: ice is its own colour.
    expect(t.ice).not.toBe(t.land);
  });

  it("never moves: no animation frames and no timers in its drawing", () => {
    expect(source).not.toMatch(/requestAnimationFrame|setInterval|setTimeout|performance\.now|Date\.now/);
  });

  it("writes no text on the canvas and no em dash anywhere in its files", () => {
    expect(source).not.toMatch(/fillText|strokeText/);
    expect(source).not.toContain("—");
    const start = css.indexOf("Burger Joint (burger):");
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start)).not.toContain("—");
    expect(css.slice(start)).not.toMatch(/style="/);
  });

  it("prints the panel's ticket with a reveal that changes no light, and not for reduced motion", () => {
    const start = css.indexOf("Burger Joint (burger):");
    const sheet = css.slice(start);
    expect(sheet).toContain("prefers-reduced-motion: no-preference");
    const frames = sheet.slice(sheet.indexOf("@keyframes burger-print"), sheet.indexOf("@keyframes burger-print") + 200);
    expect(frames).toContain("clip-path");
    expect(frames).not.toMatch(/opacity|filter|background|color/);
  });
});
