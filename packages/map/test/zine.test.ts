// Zine (src/map/zine.ts): the inks overprint purple, the second pass sits a pixel or two off, the dot screens
// get fuller where the land is darker and travel with the map, the globe's halftone shading grows toward its lower
// right limb in nested zones, and nothing moves.
import { describe, expect, it } from "vitest";
import { geoOrthographic } from "d3-geo";
import { BLUE, coverage, inZone, landScreens, misregister, overprint, PAPER, PINK, screenAnchor, SHADE_ZONES, shadeAt, worldFit, YELLOW } from "../src/map/zine.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

describe("Zine", () => {
  it("is in the Design menu, in one group and not featured, and nothing on it moves", () => {
    const t = THEMES.zine;
    expect(t.experimental).toBeFalsy();
    expect(DESIGN_GROUPS.filter((g) => g.ids.includes("zine"))).toHaveLength(1);
    expect(FEATURED).not.toContain("zine");
    expect(t.motion).toBeFalsy();
    expect(t.scene).toBeUndefined();
    expect(t.surface).toBe("zine");
  });

  it("prints its markers in the inks: pink, yellow for fresh reports, on the paper", () => {
    const t = THEMES.zine;
    expect(t.dot).toBe(PINK);
    expect(t.fresh).toBe(YELLOW);
    expect(t.fresh).not.toBe(t.dot);
    // Hollow marks are filled with the paper, so they read as empty.
    expect(t.dotStroke).toBe(PAPER);
    expect(t.tuned).toBe(BLUE);
  });

  it("overprints pink and blue as a purple darker than either ink", () => {
    const [r, g, b] = rgb(overprint(PINK, BLUE));
    expect(r).toBeGreaterThan(g);
    expect(b).toBeGreaterThan(g);
    expect(b).toBeGreaterThan(r);
    const sum = (c: number[]) => c.reduce((a, v) => a + v, 0);
    expect(r + g + b).toBeLessThan(sum(rgb(PINK)));
    expect(r + g + b).toBeLessThan(sum(rgb(BLUE)));
    // Multiplying is the same in either order, and paper-white changes nothing.
    expect(overprint(BLUE, PINK)).toBe(overprint(PINK, BLUE));
    expect(overprint(PINK, "#ffffff")).toBe(PINK);
  });

  it("sets the second pass one to two pixels off, never more, at any size", () => {
    let last = [0, 0];
    for (const [w, h] of [[320, 480], [390, 844], [800, 600], [1400, 900], [3000, 2000]] as const) {
      const [dx, dy] = misregister(w, h);
      for (const v of [dx, dy]) {
        expect(v).toBeGreaterThanOrEqual(0.8);
        expect(v).toBeLessThanOrEqual(2);
      }
      expect(dx).toBeGreaterThanOrEqual(last[0]!);
      expect(dy).toBeGreaterThanOrEqual(last[1]!);
      last = [dx, dy];
    }
  });

  it("screens fuller for mountains and lighter for ice, and never solid", () => {
    for (const R of [100, 200, 400, 2000]) {
      const s = landScreens(R);
      expect(coverage(s.ice)).toBeLessThan(coverage(s.land));
      expect(coverage(s.land)).toBeLessThan(coverage(s.peak));
      expect(coverage(s.shallow2)).toBeLessThan(coverage(s.shallow));
      expect(coverage(s.peak)).toBeLessThan(0.9);
      // Coarse: the dots stay at least six pixels apart, so the screen reads as dots and not as a grey.
      expect(s.land.pitch).toBeGreaterThanOrEqual(6);
    }
  });

  it("anchors the map's dot screens to the world, so they move with the land when it is dragged", () => {
    const at = (lon: number, lat: number) =>
      THEMES.zine
        .projection2d()
        .rotate([-lon, 0])
        .center([0, lat])
        .scale(300)
        .translate([700, 450]);
    // Every point keeps the same offset from the screens' anchor however the map is dragged, far north included.
    for (const land of [[20, 5], [100, 62], [-70, -40]] as [number, number][]) {
      const offset = (lon: number, lat: number) => {
        const p = at(lon, lat);
        const a = screenAnchor(p, false);
        const q = p(land)!;
        return [q[0] - a[0], q[1] - a[1]];
      };
      const base = offset(0, 0);
      for (const [lon, lat] of [[-60, 20], [-10, -30], [15, 0], [40, 55], [90, 10]]) {
        const o = offset(lon!, lat!);
        expect(o[0]).toBeCloseTo(base[0]!, 6);
        expect(o[1]).toBeCloseTo(base[1]!, 6);
      }
    }
    // Across the 180th meridian the anchor jumps one world; the stretched tile fits the world a whole number of times,
    // so the dots land where they were.
    for (const R of [180, 333.3, 1234.5]) {
      for (const tile of [6, 7, 8.5, 10]) {
        const world = 2 * Math.PI * R;
        const k = worldFit(tile, world);
        const n = world / (tile * k);
        expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-9);
        expect(Math.abs(k - 1)).toBeLessThan(tile / world + 1e-9);
      }
    }
    expect(worldFit(8, 0)).toBe(1);
    // The globe's screens sit on the ball's centre.
    const g = geoOrthographic().rotate([-30, -10]).scale(250).translate([400, 300]);
    expect(screenAnchor(g, true)).toEqual([400, 300]);
  });

  it("shades the globe darker toward its lower right limb and not at all on the lit side", () => {
    let last = -1;
    for (let k = -0.95; k <= 0.68; k += 0.05) {
      const d = shadeAt(k, k);
      expect(d).toBeGreaterThanOrEqual(last - 1e-9);
      last = d;
    }
    expect(shadeAt(-0.4, -0.4)).toBe(0);
    expect(shadeAt(0.68, 0.68)).toBeGreaterThan(0.85);
    expect(shadeAt(1, 1)).toBe(0);
  });

  it("prints the shading as nested zones, each inside the one before with fuller dots, on the dark side only", () => {
    for (let i = 1; i < SHADE_ZONES.length; i++) expect(SHADE_ZONES[i]!.r).toBeGreaterThan(SHADE_ZONES[i - 1]!.r);
    const n = 80;
    for (let y = 0; y <= n; y++) {
      for (let x = 0; x <= n; x++) {
        const nx = (x / n) * 2 - 1, ny = (y / n) * 2 - 1;
        // Nothing outside the ball, and nothing on the lit upper left.
        if (nx * nx + ny * ny >= 1 || (nx < 0 && ny < 0)) for (const z of SHADE_ZONES) expect(inZone(z, nx, ny)).toBe(false);
        for (let i = 1; i < SHADE_ZONES.length; i++) {
          if (inZone(SHADE_ZONES[i]!, nx, ny)) expect(inZone(SHADE_ZONES[i - 1]!, nx, ny)).toBe(true);
        }
      }
    }
    // Deeper zones sit where the ball is darker.
    const mean = (i: number) => {
      let s = 0, c = 0;
      for (let y = 0; y <= n; y++)
        for (let x = 0; x <= n; x++) {
          const nx = (x / n) * 2 - 1, ny = (y / n) * 2 - 1;
          const inside = inZone(SHADE_ZONES[i]!, nx, ny) && (i === SHADE_ZONES.length - 1 || !inZone(SHADE_ZONES[i + 1]!, nx, ny));
          if (inside) (s += shadeAt(nx, ny)), c++;
        }
      return c ? s / c : NaN;
    };
    for (let i = 1; i < SHADE_ZONES.length; i++) expect(mean(i)).toBeGreaterThan(mean(i - 1));
  });
});
