// Desktop 95 (src/map/desktop.ts, src/ui/desktop.ts): every pixel of the map comes out one of the sixteen colours, the
// globe's dithered shadow falls the same way every time and darkens toward its limb, nothing moves, and the pixel
// drawings are whole.
import { describe, expect, it } from "vitest";
import { BAYER4, buildLut, DARKER, LIGHTER, MAP_COLOURS, PALETTE, quantize, shadeAt } from "../src/map/desktop.ts";
import { GLYPHS, ICONS } from "../src/ui/desktop.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";

const inPalette = (r: number, g: number, b: number) => PALETTE.some((p) => p[0] === r && p[1] === g && p[2] === b);
const hexRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** A frame of noise: every colour there is, so the palette has to catch everything. */
function noise(w: number, h: number, seed = 7): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  for (let i = 0; i < px.length; i++) px[i] = (s = (s * 16807) % 2147483647) & 255;
  return px;
}

describe("Desktop 95", () => {
  it("is experimental, so it opens only from a link and stays off the Design menu", () => {
    const t = THEMES.desktop;
    expect(t.experimental).toBe(true);
    expect(DESIGN_GROUPS.flatMap((g) => g.ids)).not.toContain("desktop");
    expect(FEATURED).not.toContain("desktop");
    expect(t.fresh).not.toBe(t.dot);
    expect(t.motion).toBeFalsy();
    expect(t.scene).toBeUndefined();
  });

  it("draws its markers and map in the sixteen colours", () => {
    const t = THEMES.desktop;
    for (const c of [t.ocean, t.land, t.dot, t.dotStroke, t.fresh, t.tuned, t.coast]) expect(inPalette(...hexRgb(c)), c).toBe(true);
  });

  it("snaps every colour to the palette and leaves the map's own colours as they are", () => {
    const lut = buildLut();
    for (const i of MAP_COLOURS) {
      const [r, g, b] = PALETTE[i]!;
      expect(lut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]).toBe(i);
    }
    const w = 40, h = 30;
    const px = noise(w, h);
    quantize(px, w, h, null);
    for (let i = 0; i < px.length; i += 4) {
      expect(inPalette(px[i]!, px[i + 1]!, px[i + 2]!)).toBe(true);
      expect(px[i + 3]).toBe(255);
    }
  });

  it("keeps the shading's steps among the map's colours", () => {
    for (const i of MAP_COLOURS) {
      expect(MAP_COLOURS).toContain(DARKER[i]);
      expect(MAP_COLOURS).toContain(LIGHTER[i]);
    }
    expect([...BAYER4].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });

  it("shades the globe darker toward its lower right limb, the same way every time", () => {
    // Darkness never falls going out from the lit side to the far limb.
    let last = -1;
    for (let k = -0.9; k <= 0.95; k += 0.05) {
      const d = shadeAt(k * 0.7, k * 0.7).dark;
      expect(d).toBeGreaterThanOrEqual(last - 1e-9);
      last = d;
    }
    expect(shadeAt(0, 0).dark).toBe(0);
    expect(shadeAt(0.68, 0.68).dark).toBeGreaterThan(0.8);
    expect(shadeAt(1, 1)).toEqual({ dark: 0, light: 0 });

    // A flat green disc on navy: the shadow side ends up with more black than the lit side, and twice over the same.
    const w = 120, h = 120, r = 56;
    const make = () => {
      const px = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) px.set([0, 128, 0, 255], i * 4);
      quantize(px, w, h, { cx: 60, cy: 60, r });
      return px;
    };
    const a = make();
    expect(make()).toEqual(a);
    const black = (x0: number, y0: number) => {
      let n = 0;
      for (let y = y0; y < y0 + 20; y++) for (let x = x0; x < x0 + 20; x++) if (a[(y * w + x) * 4 + 1] === 0) n++;
      return n;
    };
    expect(black(80, 80)).toBeGreaterThan(black(25, 25) + 100);
    // Outside the disc nothing is shaded.
    expect([...a.subarray(0, 4)]).toEqual([0, 128, 0, 255]);
  });

  it("has whole pixel drawings: 16 by 16 icons and 8 by 7 title bar glyphs, in palette letters only", () => {
    for (const [name, rows] of Object.entries(ICONS)) {
      expect(rows.length, name).toBe(16);
      for (const row of rows) {
        expect(row.length, `${name}: ${row}`).toBe(16);
        expect(row, name).toMatch(/^[.kwsgnbGLyormt]+$/);
      }
    }
    for (const [name, rows] of Object.entries(GLYPHS)) {
      expect(rows.length, name).toBe(7);
      for (const row of rows) expect(row, name).toMatch(/^[.k]{8}$/);
    }
  });
});
