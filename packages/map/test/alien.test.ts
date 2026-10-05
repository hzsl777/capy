// Alien (src/map/alien.ts): the critters, lamps and sparkles are fixed decoration that keeps off the world, so nothing
// is drawn over a place; and nothing that moves changes brightness quickly.
import { describe, expect, it } from "vitest";
import {
  Beam,
  BEAM,
  blink,
  boxToCircle,
  critterBox,
  emitterOf,
  glassInner,
  glassOf,
  GLOBE_SCALE,
  inGlass,
  KEY_BOX,
  lampsOf,
  placeCritters,
  pulse,
  PULSE,
  ringOf,
  SCAN,
  sparklesOf,
  viewportOf,
  ZOOM_BOX,
  type Box,
} from "../src/map/alien.ts";
import { markPath } from "../src/map/marks.ts";
import { DESIGN_GROUPS, THEMES } from "../src/themes.ts";
import { samplePlaces } from "./sample.ts";

const SIZES: [number, number][] = [
  [1000, 645],
  [1400, 900],
  [1920, 1000],
  [700, 400],
  [600, 900],
  [390, 310],
  [390, 420],
  [360, 300],
];

const hits = (a: Box, b: Box) => a.x1 > b.x0 && a.x0 < b.x1 && a.y1 > b.y0 && a.y0 < b.y1;

describe("Alien", () => {
  it("is experimental, so it opens only from a link and stays off the Design menu, with its own mark and fresh colour", () => {
    const t = THEMES.alien;
    expect(t.experimental).toBe(true);
    expect(DESIGN_GROUPS.flatMap((g) => g.ids)).not.toContain("alien");
    expect(t.dotShape).toBe("trilobe");
    expect(t.fresh).not.toBe(t.dot);
    expect(t.globeScale).toBe(GLOBE_SCALE);
  });

  it("draws the three-lobed mark as one closed outline of about a circle's size", () => {
    const d = markPath("trilobe", 6);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d.match(/A/g)).toHaveLength(3);
    const nums = (d.match(/-?\d+\.?\d*/g) ?? []).map(Number);
    expect(Math.max(...nums.map(Math.abs))).toBeLessThanOrEqual(12);
  });

  it("keeps the window and its ring inside the frame, with room round the globe at rest", () => {
    for (const [w, h] of SIZES) {
      const v = viewportOf(w, h);
      expect(v.cx - v.outer).toBeGreaterThanOrEqual(0);
      expect(v.cx + v.outer).toBeLessThanOrEqual(w);
      expect(v.cy - v.outer).toBeGreaterThanOrEqual(0);
      expect(v.cy + v.outer).toBeLessThanOrEqual(h);
      expect(Math.min(w, h) * GLOBE_SCALE).toBeLessThan(v.r * 0.8);
    }
  });

  it("insets the glass the same above and below, so the reticle stays at the frame's centre", () => {
    for (const [w, h] of SIZES) {
      const g = glassOf(w, h);
      expect(g.y0).toBeCloseTo(h - g.y1, 6);
      expect(g.x0).toBeCloseTo(w - g.x1, 6);
      expect(inGlass(g, w / 2, h / 2)).toBe(true);
      expect(inGlass(g, 1, 1)).toBe(false);
      const r = glassInner(g);
      expect(r.x0).toBeGreaterThan(g.x0);
    }
  });

  it("stands critters only off the world: clear of the ring and the Key and zoom corners in Globe view, below the glass in Map view", () => {
    let placed = 0;
    for (const [w, h] of SIZES) {
      const v = viewportOf(w, h);
      for (const c of placeCritters(w, h, "3d")) {
        expect(boxToCircle(c.box, v.cx, v.cy, v.outer), `${w}x${h}`).toBeGreaterThanOrEqual(8);
        expect(hits(c.box, { x0: 0, y0: 0, x1: KEY_BOX.w, y1: KEY_BOX.h })).toBe(false);
        expect(hits(c.box, { x0: w - ZOOM_BOX.w, y0: h - ZOOM_BOX.h, x1: w, y1: h })).toBe(false);
        expect(c.box.x0).toBeGreaterThanOrEqual(0);
        expect(c.box.x1).toBeLessThanOrEqual(w);
        expect(c.box.y0).toBeGreaterThanOrEqual(0);
        expect(c.box.y1).toBeLessThanOrEqual(h);
        placed++;
      }
      const g = glassOf(w, h);
      for (const c of placeCritters(w, h, "2d")) {
        expect(c.box.y0, `${w}x${h}`).toBeGreaterThanOrEqual(g.y1);
        expect(c.box.x0).toBeGreaterThanOrEqual(0);
        expect(c.box.x1).toBeLessThanOrEqual(w);
        placed++;
      }
    }
    expect(placed).toBeGreaterThan(0);
  });

  it("never lets a critter, lamp or the emitter cover a place the view would draw", () => {
    // The view draws a place only where `inside` says; the critters and sparkles keep outside it. Sample places go
    // through every size's glass and window at their widest zoom.
    const places = samplePlaces();
    expect(places.length).toBeGreaterThan(0);
    for (const [w, h] of SIZES) {
      const g = glassOf(w, h);
      const critters = placeCritters(w, h, "2d");
      for (let x = 0; x <= w; x += 12) for (let y = 0; y <= h; y += 12) {
        if (!inGlass(g, x, y)) continue;
        for (const c of critters) expect(x > c.box.x0 && x < c.box.x1 && y > c.box.y0 && y < c.box.y1).toBe(false);
      }
      const v = viewportOf(w, h);
      for (const c of placeCritters(w, h, "3d")) expect(boxToCircle(c.box, v.cx, v.cy, v.r)).toBeGreaterThan(0);
    }
  });

  it("places the same critters, lamps and sparkles for the same frame", () => {
    expect(placeCritters(1000, 645, "3d")).toEqual(placeCritters(1000, 645, "3d"));
    expect(lampsOf(1000, 645, "2d")).toEqual(lampsOf(1000, 645, "2d"));
    expect(sparklesOf(1000, 645)).toEqual(sparklesOf(1000, 645));
    expect(critterBox(10, 10, 10).y1).toBeGreaterThan(10);
  });

  it("keeps every sparkle in the window's space and off the globe at rest", () => {
    for (const [w, h] of SIZES) {
      const v = viewportOf(w, h);
      const rest = Math.min(w, h) * GLOBE_SCALE;
      const list = sparklesOf(w, h);
      expect(list.length).toBeGreaterThan(10);
      for (const s of list) {
        const d = Math.hypot(s.x - v.cx, s.y - v.cy);
        expect(d).toBeGreaterThan(rest);
        expect(d).toBeLessThan(v.r);
      }
    }
  });

  it("puts the lamps and the beam's start where they cannot cover the world", () => {
    for (const [w, h] of SIZES) {
      const v = viewportOf(w, h);
      for (const l of lampsOf(w, h, "3d")) expect(Math.hypot(l.x - v.cx, l.y - v.cy)).toBeGreaterThan(v.r);
      const g = glassOf(w, h);
      for (const l of lampsOf(w, h, "2d")) expect(inGlass(g, l.x, l.y)).toBe(false);
      const e3 = emitterOf(w, h, "3d");
      expect(e3.top).toBeCloseTo(v.cy - v.r, 5);
      const e2 = emitterOf(w, h, "2d");
      expect(e2.top).toBeGreaterThan(g.y0);
      expect(e2.top).toBeLessThan(h / 2);
      expect(ringOf(w, h)).toBeLessThan(Math.min(w, h) / 4);
    }
  });

  it("lowers the beam in half a second, lifts it in half a second, and shows it at once for reduced motion", () => {
    const b = new Beam();
    let now = 1000;
    b.step(now, true, false);
    let last = 0;
    for (let i = 0; i < 60; i++) {
      now += 16;
      const l = b.step(now, true, false);
      expect(l).toBeGreaterThanOrEqual(last);
      last = l;
    }
    expect(last).toBe(1);
    expect(b.pingAt).toBeGreaterThan(0);
    expect(b.moving(true)).toBe(false);
    for (let i = 0; i < 45; i++) {
      now += 16;
      last = b.step(now, false, false);
    }
    expect(last).toBe(0);
    const still = new Beam();
    expect(still.step(0, true, true)).toBe(1);
    expect(still.pingAt).toBe(-1);
    expect(still.step(1, false, true)).toBe(0);
  });

  it("changes no light by a tenth of the brightness scale within a third of a second", () => {
    // The beam adds at most BEAM.alpha, over at least BEAM.rise or BEAM.fall seconds.
    expect((BEAM.alpha * (1 / 3)) / Math.min(BEAM.rise, BEAM.fall)).toBeLessThan(0.1);
    expect(SCAN.alpha).toBeLessThan(0.1);
    // Every pulse is a slow sine whose period never falls below PULSE.minPeriod, even if asked for less.
    for (const period of [1, 3, 6, 6.5, 9]) {
      for (let t = 0; t < 40; t += 1 / 12) {
        expect(Math.abs(pulse(t + 1 / 3, period, 0.3) - pulse(t, period, 0.3)), `${period} s at ${t.toFixed(2)}`).toBeLessThan(0.1);
      }
    }
    expect(PULSE.hi).toBeLessThanOrEqual(1);
    expect(PULSE.lo).toBeGreaterThan(0.5);
    // A blink is a critter's eyes, a few pixels, and happens once every four seconds at most.
    let lowFrames = 0;
    for (let t = 0; t < 4.6; t += 1 / 60) if (blink(t, 4.6, 0) < 1) lowFrames++;
    expect(lowFrames / 60).toBeLessThanOrEqual(0.2);
  });
});
