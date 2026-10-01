// Crystal Towers (src/map/towers.ts): the towers are fixed decoration that keeps clear of the globe and the plate, so
// nothing stands over a place; the opening is short; and nothing on it changes brightness quickly.
import { describe, expect, it } from "vitest";
import { nearHole, OPEN_S, PLATE_TOWERS, placeTowers, plateOf, RISE_DELAY_MAX, RISE_S, riseOf, risePhase, towerBox, TOWERS, ZOOM_H, ZOOM_W, type Hole } from "../src/map/towers.ts";
import { DESIGN_GROUPS, THEMES } from "../src/themes.ts";

const SIZES: [number, number][] = [
  [1000, 645],
  [1400, 900],
  [1920, 1000],
  [700, 400],
  [600, 900],
  [390, 520],
  [360, 440],
];

describe("Crystal Towers", () => {
  it("is experimental, so it opens only from a link and stays off the Design menu", () => {
    expect(THEMES.towers.experimental).toBe(true);
    expect(DESIGN_GROUPS.flatMap((g) => g.ids)).not.toContain("towers");
    expect(THEMES.towers.fresh).not.toBe(THEMES.towers.dot);
  });

  it("keeps every tower, its rising top cube and its reflection clear of the globe at every zoom", () => {
    let placed = 0;
    for (const [w, h] of SIZES) {
      for (const zoom of [1, 1.3, 1.6, 2.2, 4]) {
        const r = Math.min(w, h) * (THEMES.towers.globeScale ?? 0.46) * zoom;
        const hole: Hole = { kind: "disc", cx: w / 2, cy: h / 2, r };
        for (const t of placeTowers(w, h, hole)) {
          const b = towerBox(t, t.n);
          expect(nearHole(b, hole, 4), `${w}x${h} zoom ${zoom}`).toBe(false);
          expect(b.x0).toBeGreaterThanOrEqual(0);
          expect(b.x1).toBeLessThanOrEqual(w);
          expect(t.n).toBeGreaterThanOrEqual(2);
          expect(b.x1 > w - ZOOM_W && b.y1 > h - ZOOM_H, `${w}x${h} zoom ${zoom}: behind the zoom buttons`).toBe(false);
          placed++;
        }
      }
    }
    expect(placed).toBeGreaterThan(0);
  });

  it("keeps Map view's towers outside the plate, and leaves them out where there is no room", () => {
    let placed = 0;
    for (const [w, h] of SIZES) {
      const p = plateOf(w, h);
      const hole: Hole = { kind: "rect", x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 };
      const list = placeTowers(w, h, hole);
      if (w < 700) expect(list).toEqual([]);
      for (const t of list) {
        expect(nearHole(towerBox(t, t.n), hole, 4), `${w}x${h}`).toBe(false);
        placed++;
      }
    }
    expect(placed).toBeGreaterThan(0);
  });

  it("places the same towers for the same frame, from a fixed list", () => {
    const hole: Hole = { kind: "disc", cx: 500, cy: 322, r: 219 };
    expect(placeTowers(1000, 645, hole)).toEqual(placeTowers(1000, 645, hole));
    expect(TOWERS.length + PLATE_TOWERS.length).toBeGreaterThan(0);
  });

  it("finishes the opening in under two seconds", () => {
    expect(RISE_DELAY_MAX + RISE_S).toBeLessThanOrEqual(OPEN_S);
    expect(OPEN_S).toBeLessThan(2);
    for (const t of placeTowers(1000, 645, { kind: "disc", cx: 500, cy: 322, r: 219 })) {
      expect(riseOf(t, 0)).toBe(0);
      expect(riseOf(t, OPEN_S)).toBe(1);
    }
  });

  it("fades a tower's top cube slowly: no 10% swing within a third of a second", () => {
    for (const t of placeTowers(1400, 900, { kind: "disc", cx: 700, cy: 450, r: 306 })) {
      for (let s = 0; s < 60; s += 1 / 12) {
        const a = risePhase(t, s), b = risePhase(t, s + 1 / 3);
        // Where the phase wraps, the next cube up takes the faded one's place, so the picture carries on unbroken.
        if (b < a) continue;
        expect(b - a, `at ${s.toFixed(2)} s`).toBeLessThan(0.1);
      }
    }
  });
});
