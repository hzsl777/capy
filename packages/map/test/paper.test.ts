// Paper Screen (src/map/paper.ts, src/ui/paper.ts): an experimental design that stays off the Design menu; greys only,
// at most sixteen, on the canvas and in the chrome; fresh reports read apart by the dotted ring, not a colour; the
// stipple is the same on every load; the page turn's refresh never flashes (WCAG 2.3.1); and the pages' parts show in
// this design only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GREYS, INK, luminance, PAPER, REFRESH_GREY_LEVEL, REFRESH_LOW, REFRESH_MS, refreshOpacity, SETTLE_MS, stippleDots } from "../src/map/paper.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const css = readFileSync(here("../src/style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** Every rule of the stylesheet that names this design, with its body. */
const paperRules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! })).filter((r) => r.sel.includes('data-theme="paper"'));

describe("Paper Screen", () => {
  it("is experimental, so it opens only from a link and stays off the Design menu", () => {
    const t = THEMES.paper;
    expect(t.experimental).toBe(true);
    expect(DESIGN_GROUPS.flatMap((g) => g.ids)).not.toContain("paper");
    expect(FEATURED).not.toContain("paper");
    expect(t.surface).toBe("paper");
  });

  it("has sixteen greys from ink to paper, each a grey and lighter than the last", () => {
    expect(GREYS).toHaveLength(16);
    expect(new Set(GREYS).size).toBe(16);
    expect(GREYS[0]).toBe(INK);
    expect(GREYS[15]).toBe(PAPER);
    for (let i = 0; i < 16; i++) {
      const [r, g, b] = rgb(GREYS[i]!);
      // A warm paper white, never a colour: the channels stay within a few steps of each other.
      expect(Math.max(r, g, b) - Math.min(r, g, b), GREYS[i]).toBeLessThanOrEqual(8);
      if (i > 0) expect(luminance(GREYS[i]!)).toBeGreaterThan(luminance(GREYS[i - 1]!));
    }
  });

  it("draws the map and its markers only in those greys", () => {
    const t = THEMES.paper;
    const colours = Object.values(t).filter((v): v is string => typeof v === "string" && v.startsWith("#"));
    expect(colours.length).toBeGreaterThan(10);
    for (const c of colours) expect(GREYS, c).toContain(c);
  });

  it("dresses the page only in those greys", () => {
    const tokens = paperRules.find((r) => r.sel === ':root[data-theme="paper"]')!.body;
    GREYS.forEach((g, i) => expect(tokens).toMatch(new RegExp(`--pp-g${i}:\\s*${g};`)));
    for (const r of paperRules) {
      for (const hex of r.body.match(/#[0-9a-f]{3,8}\b/gi) ?? []) expect(GREYS, `${r.sel}: ${hex}`).toContain(hex.toLowerCase());
      // The one translucent colour is the ink, dimming the page behind a dialog.
      for (const m of r.body.matchAll(/rgba?\(([^)]*)\)/g)) expect(m[1]!.split(",").slice(0, 3).map((v) => +v), r.sel).toEqual(rgb(INK));
    }
  });

  it("tells fresh reports apart by the dotted ring, with an outline that shows against the ink", () => {
    const t = THEMES.paper;
    // Equal colours make the view add the dotted ring for fresh reports, as in the other monochrome designs.
    expect(t.fresh).toBe(t.dot);
    expect(t.dotStroke).not.toBe(t.dot);
    expect(t.dotShape).toBe("circle");
  });

  it("stipples the land the same way on every load, evenly and in a mid grey", () => {
    const a = stippleDots();
    expect(stippleDots()).toEqual(a);
    const side = 160;
    const seen = new Set<number>();
    for (const [x, y] of a) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(side);
      expect(y).toBeLessThan(side);
      seen.add(y * side + x);
    }
    expect(seen.size).toBe(a.length);
    for (const [x, y] of a) expect(seen.has(y * side + ((x + 1) % side))).toBe(false);
    const inked = a.length / (side * side);
    expect(inked).toBeGreaterThan(0.1);
    expect(inked).toBeLessThan(0.25);
  });

  it("redraws in full soon after the map stops", () => {
    expect(SETTLE_MS).toBeGreaterThan(50);
    expect(SETTLE_MS).toBeLessThan(400);
  });

  it("turns a page with a refresh that never flashes", () => {
    // The refresh dips once and comes back inside a third of a second.
    expect(REFRESH_MS).toBeLessThan(1000 / 3);
    expect(refreshOpacity(0)).toBeCloseTo(1, 9);
    expect(refreshOpacity(1)).toBeCloseTo(1, 9);
    expect(refreshOpacity(0.5)).toBeCloseTo(REFRESH_LOW, 9);
    // The page's paper fades toward the grey behind it; the light it gives never moves by a tenth of the screen's
    // brightness, so even a reader turning pages as fast as they can never sees a flash.
    const grey = rgb(GREYS[REFRESH_GREY_LEVEL]!);
    const paper = rgb(PAPER);
    const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
    let worst = 0;
    for (let i = 0; i <= 100; i++) {
      const a = refreshOpacity(i / 100);
      expect(a).toBeGreaterThanOrEqual(REFRESH_LOW - 1e-9);
      expect(a).toBeLessThanOrEqual(1 + 1e-9);
      const seen = hex(paper.map((p, k) => p * a + grey[k]! * (1 - a)));
      worst = Math.max(worst, Math.abs(luminance(seen) - luminance(PAPER)));
    }
    expect(worst).toBeLessThan(0.1);
    // The grey is the one the stylesheet puts behind the panel and the dialog.
    const stage = paperRules.find((r) => r.sel === ':root[data-theme="paper"] .stage')!.body;
    expect(stage).toMatch(new RegExp(`background:\\s*var\\(--pp-g${REFRESH_GREY_LEVEL}\\)`));
  });

  it("shows the page's foot and the bezel's buttons in this design only", () => {
    const rules = [...css.matchAll(/([^{}]*\.pp-(?:pager|side)(?![\w-])[^{}]*)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
    const base = rules.filter((r) => /^\.pp-pager,\s*\.pp-side$/.test(r.sel));
    expect(base).toHaveLength(1);
    expect(base[0]!.body).toMatch(/display:\s*none/);
    for (const r of rules) if (/display:\s*(?!none)\w/.test(r.body)) expect(r.sel, r.sel).toContain(':root[data-theme="paper"]');
  });
});
