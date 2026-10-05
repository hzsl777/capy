// Machine Music (src/map/machine.ts, src/ui/machine.ts): an experimental design that stays off the Design menu; its rack
// under the map shows only in this design; and everything that moves never flashes (WCAG 2.3.1): the sequencer lights
// one step at a time, slowly, so the row's light holds steady and no step lights more than three times a second, and
// the chasers are a few pixels tall and step at the same slow pace. The stage's picture is the canvas's and never lies
// over the globe, and its readouts print the reticle's position as they should.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BAND_DEG,
  bandOf,
  CHASE_CELLS,
  CHASE_PERIOD_S,
  CONES,
  consoleBoxes,
  gridStep,
  latText,
  lonText,
  METER_SWING_S,
  padLevels,
  SCOPE_PASS_S,
  SEQ_FADE_S,
  SEQ_HZ,
  SEQ_PATTERN,
  SEQ_STEPS,
  SEQ_STILL,
  seqStep,
  STAGE_AT,
  zoomLamps,
} from "../src/map/machine.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const css = readFileSync(here("../src/style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("Machine Music", () => {
  it("is experimental, so it opens only from a link and stays off the Design menu", () => {
    const t = THEMES.machine;
    expect(t.experimental).toBe(true);
    expect(DESIGN_GROUPS.flatMap((g) => g.ids)).not.toContain("machine");
    expect(FEATURED).not.toContain("machine");
    expect(t.surface).toBe("machine");
  });

  it("keeps fresh reports apart from the normal marker", () => {
    const t = THEMES.machine;
    expect(t.fresh).not.toBe(t.dot);
    expect(t.dotStroke).not.toBe(t.dot);
    expect(t.dotShape).toBe("square");
  });

  it("shows the rack under the map in this design only", () => {
    // Every rule that names the rack on its own (not a part inside it), with what it sets.
    const rules = [...css.matchAll(/([^{}]*\.x-rack(?![\w-])[^{}]*)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
    const base = rules.filter((r) => r.sel === ".x-rack");
    expect(base).toHaveLength(1);
    expect(base[0]!.body).toMatch(/display:\s*none/);
    for (const r of rules) {
      const shows = /display:\s*(?!none)\w/.test(r.body);
      if (shows) expect(r.sel, r.sel).toContain(':root[data-theme="machine"]');
    }
  });

  it("styles the page's decoration for this design alone", () => {
    // The diagonal behind the page and the chasers' pieces are only ever set under the design's own attribute.
    for (const m of css.matchAll(/([^{}]*)(?:body::before|\.toolbar::after|\.timebar::before)([^{}]*)\{/g)) {
      const sel = `${m[1]}${m[2]}`;
      if (/machine/.test(sel) || /machine-chase/.test(sel)) continue;
      // Other designs may use these pseudo-elements; none of this design's rules may leak into them.
      expect(sel).not.toMatch(/--cell|--hazard/);
    }
    expect(css).toMatch(/:root\[data-theme="machine"\] body::before/);
  });
});

describe("Machine Music's sequencer", () => {
  it("walks one step at a time, two a second, round all sixteen", () => {
    expect(SEQ_HZ).toBeLessThanOrEqual(3);
    const seen = new Set<number>();
    for (let i = 0; i < SEQ_STEPS; i++) seen.add(seqStep(i / SEQ_HZ + 0.01));
    expect(seen.size).toBe(SEQ_STEPS);
    expect(seqStep(1 / SEQ_HZ + 0.01)).toBe((seqStep(0.01) + 1) % SEQ_STEPS);
  });

  it("fades each step in less than a step, so at most two are ever lit", () => {
    expect(SEQ_FADE_S).toBeLessThan(1 / SEQ_HZ);
    for (let t = 0; t < 20; t += 0.013) {
      const lv = padLevels(t);
      expect(lv.filter((v) => v > 0).length).toBeLessThanOrEqual(2);
      for (const v of lv) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("holds the row's light steady: it never swings 10% within a third of a second", () => {
    // The row holds one lit step's worth of light at every moment; measured against that, it barely changes.
    const dt = 1 / 3;
    for (let t = 0; t < 20; t += 0.017) {
      const a = sum(padLevels(t));
      const b = sum(padLevels(t + dt));
      expect(a).toBeCloseTo(1, 6);
      expect(Math.abs(a - b), `at ${t.toFixed(3)} s`).toBeLessThan(0.1);
    }
  });

  it("lights each step at most once a second, far under three flashes a second", () => {
    for (let k = 0; k < SEQ_STEPS; k++) {
      const ons: number[] = [];
      let was = 0;
      for (let t = 0; t < 40; t += 0.01) {
        const v = padLevels(t)[k]!;
        if (v >= 0.5 && was < 0.5) ons.push(t);
        was = v;
      }
      for (let i = 1; i < ons.length; i++) expect(ons[i]! - ons[i - 1]!).toBeGreaterThanOrEqual(1);
    }
  });

  it("holds one step still for reduced motion", () => {
    for (const t of [0, 0.4, 3, 77.7]) {
      expect(seqStep(t, true)).toBe(SEQ_STILL);
      const lv = padLevels(t, true);
      expect(lv[SEQ_STILL]).toBe(1);
      expect(sum(lv)).toBe(1);
    }
  });

  it("moves its meters and scope slowly", () => {
    for (const s of METER_SWING_S) expect(s).toBeGreaterThanOrEqual(2);
    expect(SCOPE_PASS_S).toBeGreaterThanOrEqual(2);
  });

  it("keeps a fixed pattern of programmed steps, four bars of four, that never changes", () => {
    expect(SEQ_PATTERN).toHaveLength(SEQ_STEPS);
    for (const v of SEQ_PATTERN) expect([0, 1]).toContain(v);
    // Some steps are programmed and some are not, and the downbeat of each bar is not left to chance.
    expect(sum([...SEQ_PATTERN])).toBeGreaterThan(3);
    expect(sum([...SEQ_PATTERN])).toBeLessThan(SEQ_STEPS - 3);
  });
});

describe("Machine Music's chasers", () => {
  const rule = (sel: RegExp) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find((m) => sel.test(m[1]!))?.[2] ?? "";

  it("step a lit cell along sixteen cells at the sequencer's pace", () => {
    expect(CHASE_CELLS).toBe(SEQ_STEPS);
    expect(CHASE_PERIOD_S).toBe(SEQ_STEPS / SEQ_HZ);
    const body = rule(/machine"\] \.toolbar::after,\s*:root\[data-theme="machine"\] \.timebar::before/);
    expect(body).toContain(`animation: machine-chase ${CHASE_PERIOD_S}s steps(${CHASE_CELLS})`);
  });

  it("are a few pixels tall, and the lit cell is a small part of the row", () => {
    const body = rule(/machine"\] \.toolbar::after,\s*:root\[data-theme="machine"\] \.timebar::before/);
    const height = Number(/height:\s*(\d+)px/.exec(body)?.[1]);
    expect(height).toBeLessThanOrEqual(4);
    // One lit cell of 14 pixels in every 320 (sixteen cells of 20): a thin lit dash walking along the row.
    expect(css).toMatch(/--cell-lit: linear-gradient\(90deg, #ff4d42 0 14px, transparent 14px\) 0 0 \/ 320px/);
    expect(320 / 20).toBe(CHASE_CELLS);
  });

  it("stand still for reduced motion", () => {
    const reduce = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?\n\})/g;
    const blocks = [...css.matchAll(reduce)].map((m) => m[1]!).filter((b) => b.includes('data-theme="machine"'));
    expect(blocks.some((b) => b.includes(".toolbar::after") && b.includes(".timebar::before") && /animation:\s*none/.test(b))).toBe(true);
  });
});

describe("Machine Music's rack", () => {
  it("prints the reticle's position as a display would", () => {
    expect(lonText(36.82)).toBe("036.8E");
    expect(lonText(-0.04)).toBe("000.0W");
    expect(lonText(-122.4)).toBe("122.4W");
    expect(lonText(190)).toBe("170.0W");
    expect(latText(-1.29)).toBe("01.3S");
    expect(latText(51.5)).toBe("51.5N");
    expect(latText(0)).toBe("00.0N");
  });

  it("lights as many zoom lamps as the map has levels showing, at least one and never more than there are", () => {
    expect(zoomLamps(0, 5)).toBe(1);
    expect(zoomLamps(2, 5)).toBe(3);
    expect(zoomLamps(4, 5)).toBe(5);
    expect(zoomLamps(9, 5)).toBe(5);
    expect(zoomLamps(-1, 5)).toBe(1);
  });
});

describe("Machine Music's picture", () => {
  it("lets the spotlights land on the stage below the sphere, from above it", () => {
    expect(STAGE_AT).toBeGreaterThan(1);
    for (const c of CONES) {
      expect(Math.abs(c.top)).toBeGreaterThan(1);
      expect(c.w1).toBeGreaterThan(c.w0);
    }
  });

  it("rules a finer grid as the map is zoomed in", () => {
    expect(gridStep(1)).toBeGreaterThan(gridStep(3));
    expect(gridStep(3)).toBeGreaterThan(gridStep(8));
  });

  it("runs one diagonal up to the right, at a steep enough angle to read as a diagonal and no more", () => {
    expect(BAND_DEG).toBeGreaterThan(15);
    expect(BAND_DEG).toBeLessThan(45);
    for (const [cx, cy, R] of [
      [500, 300, 214],
      [195, 120, 70],
    ] as const) {
      const b = bandOf(cx, cy, R);
      // Rising to the right: x grows as y shrinks along the band; the normal is square to it.
      expect(b.dx).toBeGreaterThan(0);
      expect(b.dy).toBeLessThan(0);
      expect(b.dx * b.nx + b.dy * b.ny).toBeCloseTo(0, 9);
      expect(Math.hypot(b.dx, b.dy)).toBeCloseTo(1, 9);
      // The grey stripe lies beside the red band, not on it.
      expect(b.stripeAt - b.stripeHalf).toBeGreaterThan(b.half);
    }
  });

  it("stands the consoles on the floor beside the sphere, clear of it and inside the frame", () => {
    for (const [w, h, R] of [
      [980, 550, 198],
      [1200, 700, 252],
      [390, 240, 86],
      [980, 300, 108],
    ] as const) {
      const cx = w / 2, cy = h / 2;
      const boxes = consoleBoxes(w, h, cx, cy, R);
      for (const b of boxes) {
        // Inside the frame, below the sphere's foot and not one pixel of it inside the sphere's circle.
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(w);
        expect(b.y + b.h).toBeLessThanOrEqual(h);
        expect(b.y).toBeGreaterThanOrEqual(cy + R * STAGE_AT);
        const nx = Math.max(b.x, Math.min(cx, b.x + b.w));
        const ny = Math.max(b.y - 14, Math.min(cy, b.y + b.h));
        expect(Math.hypot(nx - cx, ny - cy), `${w}x${h}`).toBeGreaterThan(R);
      }
    }
  });

  it("leaves the consoles out when there is no floor or no room for them", () => {
    expect(consoleBoxes(390, 140, 195, 70, 86)).toEqual([]);
    expect(consoleBoxes(300, 400, 150, 200, 144)).toEqual([]);
  });
});
