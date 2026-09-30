import { geoOrthographic } from "d3-geo";
import { describe, expect, it } from "vitest";
import { ballGlints, buildBall, css, FLOOR_COLORS, floorColor, hexRGB, lensInverse, lensOf, lensPoint, mix, Snow, type RGB } from "../src/map/scenes.ts";
import { THEMES } from "../src/themes.ts";

/** WCAG relative luminance of an sRGB colour. */
function luminance([r, g, b]: RGB): number {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

const FPS = 12;

describe("Snow Globe's lens", () => {
  const L = lensOf(1000, 600);

  it("leaves the centre in place, so the reticle tunes the same place", () => {
    const [x, y] = lensPoint(L, 500, 300);
    expect(x).toBeCloseTo(500);
    expect(y).toBeCloseTo(300);
  });

  it("can be undone, so a point on the glass maps back to the map", () => {
    for (const [x, y] of [
      [520, 310],
      [100, 80],
      [900, 550],
      [-300, 900],
    ]) {
      const [sx, sy] = lensPoint(L, x!, y!);
      const [bx, by] = lensInverse(L, sx, sy);
      expect(bx).toBeCloseTo(x!, 6);
      expect(by).toBeCloseTo(y!, 6);
    }
  });

  it("never folds: farther on the map is always farther on the glass", () => {
    let last = -1;
    for (let d = 0; d < 5000; d += 5) {
      const [sx] = lensPoint(L, 500 + d, 300);
      expect(sx).toBeGreaterThan(last);
      last = sx;
    }
  });
});

describe("no flashing (WCAG 2.3.1)", () => {
  it("the dance floor's colours change slowly: no 10% swing in brightness within a third of a second", () => {
    for (let cls = 0; cls < FLOOR_COLORS.length; cls++) {
      for (let f = 0; f < 60 * FPS; f++) {
        const t = f / FPS;
        const a = luminance(floorColor(cls, t));
        const b = luminance(floorColor(cls, t + 1 / 3));
        expect(Math.abs(a - b), `class ${cls} at ${t.toFixed(2)} s`).toBeLessThan(0.1);
      }
    }
  });

  it("the mirror ball's glints brighten and fade over about a second, never faster", () => {
    const proj = geoOrthographic().rotate([-20, -10]).scale(300).translate([400, 400]);
    const ball = buildBall({
      proj,
      lon: 20,
      lat: 10,
      w: 800,
      h: 800,
      step: 3,
      isLand: (lon) => lon > 0,
      anchors: [],
      land: [hexRGB("#2c0b40"), hexRGB("#ff9be9")],
      sea: [hexRGB("#101626"), hexRGB("#dfe9ff")],
    });
    const lights: RGB[] = [
      [255, 255, 255],
      [255, 140, 235],
      [120, 235, 255],
    ];
    // The glint level (0 to 4) of every facet, per light, for 30 seconds of frames.
    const levels = (t: number) => {
      const out = new Map<string, number>();
      for (const [key, list] of ballGlints(ball, t, lights)) {
        const [light, level] = key.split(":").map(Number);
        for (const quad of list) out.set(`${light}:${quad}`, level!);
      }
      return out;
    };
    let lit = 0;
    const frames = Array.from({ length: 30 * FPS }, (_, f) => levels(f / FPS));
    for (let f = 0; f + 4 < frames.length; f++) {
      const now = frames[f]!, later = frames[f + 4]!;
      for (const key of new Set([...now.keys(), ...later.keys()])) {
        // A third of a second later, a facet is at most half as bright or half as dark again.
        expect(Math.abs((now.get(key) ?? 0) - (later.get(key) ?? 0)), key).toBeLessThanOrEqual(2);
      }
      lit += now.size;
    }
    expect(lit).toBeGreaterThan(0);
  });

  it("the floor never uses a colour close to Nightclub's fresh-report colour", () => {
    const fresh = hexRGB(THEMES.club.fresh);
    for (let cls = 0; cls < FLOOR_COLORS.length; cls++) {
      for (let t = 0; t < 30; t += 0.25) {
        const c = floorColor(cls, t);
        const d = Math.hypot(c[0] - fresh[0], c[1] - fresh[1], c[2] - fresh[2]);
        expect(d, css(c)).toBeGreaterThan(120);
      }
    }
  });
});

describe("mirror ball facets", () => {
  it("a facet holding a place is land, even where the land data has sea", () => {
    const proj = geoOrthographic().rotate([-60, 0]).scale(300).translate([400, 400]);
    const landColors: [RGB, RGB] = [hexRGB("#2c0b40"), hexRGB("#ff9be9")];
    const opts = { proj, lon: 60, lat: 0, w: 800, h: 800, step: 3, isLand: () => false, land: landColors, sea: [hexRGB("#101626"), hexRGB("#dfe9ff")] as [RGB, RGB] };
    const landFills = new Set(Array.from({ length: 11 }, (_, i) => css(mix(landColors[0], landColors[1], i / 10))));
    const without = buildBall({ ...opts, anchors: [] });
    expect([...without.fills.keys()].some((c) => landFills.has(c))).toBe(false);
    const withPlace = buildBall({ ...opts, anchors: [[61.2, 0.8]] });
    const land = [...withPlace.fills.entries()].filter(([c]) => landFills.has(c));
    expect(land.flatMap(([, list]) => list)).toHaveLength(1);
  });
});

describe("snow", () => {
  for (const shape of ["dome", "box"] as const) {
    it(`settles after a stir and stays inside (${shape})`, () => {
      const snow = new Snow(200, shape, 1.6);
      snow.stir(1, 1, 0);
      let moving = snow.n;
      let t = 0;
      for (; t < 40 && moving > 0; t += 1 / FPS) {
        moving = snow.step(1 / FPS, t);
        for (let i = 0; i < snow.n; i++) {
          if (shape === "dome") expect(Math.hypot(snow.x[i]!, snow.y[i]!)).toBeLessThan(0.97);
          else expect(Math.abs(snow.x[i]!)).toBeLessThanOrEqual(1.6 + 1e-6);
        }
      }
      // Settled well within half a minute, after which the scene stops asking for frames.
      expect(moving).toBe(0);
      expect(t).toBeLessThan(30);
    });
  }

  it("a stir lifts settled flakes off the floor", () => {
    const snow = new Snow(100, "dome");
    snow.settle();
    expect(snow.step(1 / FPS, 0)).toBeLessThan(40);
    snow.stir(1, 0, -1);
    expect(snow.step(1 / FPS, 0.1)).toBeGreaterThan(60);
  });
});
