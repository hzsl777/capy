// Machine Music (src/map/machine.ts): an experimental design that stays off the Design menu; its rack under the map
// shows only in this design; and the rack's moving light never flashes (WCAG 2.3.1): the sequencer lights one step at
// a time, slowly, so the row's light holds steady and no step lights more than three times a second.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONES, gridStep, METER_SWING_S, padLevels, SCOPE_PASS_S, SEQ_FADE_S, SEQ_HZ, SEQ_STEPS, SEQ_STILL, seqStep, STAGE_AT } from "../src/map/machine.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

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
    const css = readFileSync(here("../src/style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
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
});
