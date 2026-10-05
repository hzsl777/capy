// Tiramisu (src/map/tiramisu.ts): the spoon swirls in the cream are tied to the world's longitude and latitude, the
// dish and the bowl have the shape the drawing assumes, the spoon and the sieve on the table keep clear of the plate,
// the Key, the zoom buttons and each other, the design is in the menu, and nothing in it moves.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { beanCrease, markPath } from "../src/map/marks.ts";
import { bowlOf, dishOf, KEY_BOX, LAYERS, placeTools, swirlAt, swirlStep, ZOOM_BOX } from "../src/map/tiramisu.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";
import { cssFor } from "./css.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const source = readFileSync(here("../src/map/tiramisu.ts"), "utf8");
const css = cssFor("tiramisu");

describe("tiramisu: the cream's swirls", () => {
  it("gives the same swirl to the same cell, always", () => {
    expect(swirlAt(2, 40, 17)).toEqual(swirlAt(2, 40, 17));
    expect(swirlAt(2, 40, 17)).not.toEqual(swirlAt(2, 41, 17));
  });

  it("keeps each swirl inside its own cell of the world and never closes it into a ring", () => {
    for (const step of [0.5, 2, 6]) {
      for (let i = 0; i < 30; i++) {
        for (let j = 0; j < 20; j++) {
          const s = swirlAt(step, i, j);
          expect(Math.abs(s.lon - (i + 0.5) * step + 180)).toBeLessThanOrEqual(step * 0.36);
          expect(Math.abs(s.lat - (j + 0.5) * step + 90)).toBeLessThanOrEqual(step * 0.36);
          expect(s.sweep).toBeLessThan(Math.PI * 2 - 1);
          expect(s.size).toBeGreaterThan(0.7);
        }
      }
    }
  });

  it("picks a grid step that divides the world and is about the swirl's width on screen", () => {
    for (const pxDeg of [0.5, 1, 3, 10, 80, 400]) {
      const step = swirlStep(pxDeg);
      expect(360 / step).toBe(Math.round(360 / step));
      expect(step * pxDeg).toBeGreaterThanOrEqual(Math.min(26, 6 * pxDeg));
    }
  });
});

describe("tiramisu: the dish and the bowl", () => {
  for (const [w, h] of [[1400, 900], [960, 600], [390, 300], [390, 520]] as const) {
    it(`fits the dish in a ${w} by ${h} frame, the side right under the top`, () => {
      const d = dishOf(w, h);
      expect(d.inner.x0).toBeGreaterThan(d.outer.x0);
      expect(d.inner.y0).toBeGreaterThan(d.outer.y0);
      expect(d.inner.x1).toBeLessThan(d.outer.x1);
      expect(d.side.y0).toBe(d.inner.y1);
      expect(d.side.y1).toBeLessThan(d.outer.y1);
      expect(d.inner.x1 - d.inner.x0).toBeGreaterThan(0);
      expect(d.inner.y1 - d.inner.y0).toBeGreaterThan(0);
    });
  }

  it("shows the layers in order and they fill the side", () => {
    expect(LAYERS.map(([k]) => k)).toEqual(["cocoa", "cream", "sponge", "cream", "sponge"]);
    expect(LAYERS.reduce((s, [, n]) => s + n, 0)).toBeCloseTo(1, 6);
  });

  it("puts the bowl's rings outside the ball, in order", () => {
    const b = bowlOf(100);
    expect(b.layers).toBeGreaterThan(100);
    expect(b.glass).toBeGreaterThan(b.layers);
    expect(b.well).toBeGreaterThan(b.glass);
    expect(b.plate).toBeGreaterThan(b.well);
  });
});

describe("tiramisu: the spoon and the sieve on the table", () => {
  const frames: [number, number][] = [[1000, 700], [1400, 900], [390, 520], [390, 380], [700, 500], [320, 260]];
  it("never touch the plate, the Key, the zoom buttons, the frame's edge or each other", () => {
    for (const [w, h] of frames) {
      for (const k of [0.4, 0.6, 0.8, 1]) {
        const R = Math.min(w, h) * 0.34 * k;
        const cx = w / 2, cy = h / 2;
        const tools = placeTools(w, h, cx, cy, R, R / k);
        const P = bowlOf(R).plate;
        for (const t of tools) {
          expect(Math.hypot(t.x - cx, t.y - cy)).toBeGreaterThan(P + t.s);
          expect(t.x - t.s).toBeGreaterThanOrEqual(0);
          expect(t.y - t.s).toBeGreaterThanOrEqual(0);
          expect(t.x + t.s).toBeLessThanOrEqual(w);
          expect(t.y + t.s).toBeLessThanOrEqual(h);
          const nearKey = t.x - t.s < KEY_BOX.w && t.y - t.s < KEY_BOX.h;
          const nearZoom = t.x + t.s > w - ZOOM_BOX.w && t.y + t.s > h - ZOOM_BOX.h;
          expect(nearKey || nearZoom).toBe(false);
        }
        for (let i = 0; i < tools.length; i++) for (let j = i + 1; j < tools.length; j++) expect(Math.hypot(tools[i]!.x - tools[j]!.x, tools[i]!.y - tools[j]!.y)).toBeGreaterThan(tools[i]!.s + tools[j]!.s);
      }
    }
  });

  it("are the same every time and at most one of each", () => {
    const a = placeTools(1400, 900, 700, 450, 300, 300);
    expect(placeTools(1400, 900, 700, 450, 300, 300)).toEqual(a);
    expect(new Set(a.map((t) => t.kind)).size).toBe(a.length);
  });

  it("are left out when the ball fills the frame", () => {
    expect(placeTools(400, 400, 200, 200, 190, 190)).toEqual([]);
  });
});

describe("tiramisu: the design", () => {
  const t = THEMES.tiramisu;

  it("is in the Design menu, in one group and not featured (decision 134)", () => {
    expect(t.surface).toBe("tiramisu");
    expect(t.experimental).toBeFalsy();
    expect(DESIGN_GROUPS.filter((g) => g.ids.includes("tiramisu"))).toHaveLength(1);
    expect(FEATURED).not.toContain("tiramisu");
    expect(FEATURED).not.toContain("tiramisu");
  });

  it("marks places with a coffee bean, a different outline from a circle, still one closed shape, with fresh in another colour", () => {
    expect(t.dotShape).toBe("bean");
    expect(markPath("bean", 6)).not.toBe(markPath("circle", 6));
    expect(markPath("bean", 6).endsWith("Z")).toBe(true);
    expect(t.fresh).not.toBe(t.dot);
    expect(beanCrease(6)).not.toBe("");
  });

  it("keeps the sea dark and the land light, so the coast is the only edge and borders are never drawn", () => {
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    };
    expect(lum(t.land)).toBeGreaterThan(lum(t.ocean) + 100);
  });

  it("never moves: no animation frames and no timers in its drawing", () => {
    expect(source).not.toMatch(/requestAnimationFrame|setInterval|setTimeout|performance\.now|Date\.now/);
  });

  it("writes no text on the canvas and no em dash anywhere in its files", () => {
    expect(source).not.toMatch(/fillText|strokeText/);
    expect(source).not.toContain("—");
    const start = css.indexOf('data-theme="tiramisu"');
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start)).not.toContain("—");
  });
});
