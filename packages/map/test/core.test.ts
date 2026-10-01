// Green Core's light never flashes (WCAG 2.3.1): the opening, the energy in the orb, the light along the tubes and
// the halo's hum each change any large area by less than a tenth of the brightness scale within a third of a second.
import { describe, expect, it } from "vitest";
import { BOOT_S, bootLight, bootShade, CORE, ENERGY_ALPHA, ENERGY_FADE, hum, PULSE_ALPHA, SEA_STOPS, stopAt, type RGB } from "../src/map/core.ts";
import { THEMES } from "../src/themes.ts";

/** WCAG relative luminance of an sRGB colour (channels 0 to 255, clamped). */
function luminance([r, g, b]: RGB): number {
  const c = (v: number) => {
    const s = Math.min(255, Math.max(0, v)) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const add = (c: RGB, d: RGB, a: number): RGB => [c[0] + d[0] * a, c[1] + d[1] * a, c[2] + d[2] * a];
const hex = (s: string): RGB => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

/** The large lit areas of the picture: the orb's sea, the land, the ice and the inside of a tube. */
const LARGE: [string, RGB][] = [
  ["sea at the core", CORE.seaCore],
  ["sea", CORE.sea],
  ["land", CORE.land],
  ["land in shade", CORE.landShade],
  ["ice", CORE.ice],
  ["tube", CORE.tubeLit],
];

const FPS = 12;

describe("Green Core's opening", () => {
  it("lights up from dark in under two seconds", () => {
    expect(BOOT_S).toBeLessThan(2);
    expect(bootLight(0)).toBeLessThan(0.1);
    expect(bootLight(BOOT_S)).toBe(1);
    expect(bootLight(60)).toBe(1);
  });

  it("is already lit for reduced motion", () => {
    expect(bootLight(0, true)).toBe(1);
    expect(bootShade(0, true)).toBe(1);
  });

  it("never brightens a large area by a tenth of the scale within a third of a second", () => {
    for (const [name, c] of LARGE) {
      for (let f = 0; f <= 3 * FPS; f++) {
        const t = f / FPS;
        const a = luminance(scale(c, bootShade(t)));
        const b = luminance(scale(c, bootShade(t + 1 / 3)));
        expect(b - a, `${name} at ${t.toFixed(2)} s`).toBeLessThan(0.1);
        expect(b).toBeGreaterThanOrEqual(a);
      }
    }
  });
});

describe("Green Core's moving light", () => {
  it("the energy turning in the sea adds less than a tenth of the scale where it is brightest", () => {
    // Every arm of both turns crossing at once, at every distance from the orb's centre, over the sea there.
    for (let i = 0; i <= 100; i++) {
      const s = i / 100;
      const sea = stopAt(SEA_STOPS, s);
      const d = luminance(add(sea, CORE.energy, ENERGY_ALPHA * stopAt(ENERGY_FADE, s))) - luminance(sea);
      expect(d, `at ${s}`).toBeLessThan(0.1);
    }
  });

  it("a pulse of light along a tube adds less than a tenth of the scale", () => {
    for (const tube of [CORE.tube, CORE.tubeLit]) {
      const d = luminance(add(tube, CORE.pulse, PULSE_ALPHA)) - luminance(tube);
      expect(d).toBeLessThan(0.1);
    }
  });

  it("the halo's hum is slow: well under a tenth of the scale in a third of a second", () => {
    // The halo is the energy colour at 0.3 + 0.06 * hum over the dark room, at most.
    const room: RGB = [3, 17, 10];
    for (let f = 0; f < 16 * FPS; f++) {
      const t = f / FPS;
      const a = luminance(add(room, CORE.energy, 0.3 + 0.06 * hum(t)));
      const b = luminance(add(room, CORE.energy, 0.3 + 0.06 * hum(t + 1 / 3)));
      expect(Math.abs(a - b)).toBeLessThan(0.02);
    }
  });
});

describe("Green Core's markers", () => {
  const t = THEMES.core;

  it("is experimental: opened by link, not listed in the Design menu's groups", () => {
    expect(t.experimental).toBe(true);
    expect(t.surface).toBe("core");
  });

  it("fresh reports stand out from other places, and neither marker is the picture's green", () => {
    const dot = hex(t.dot), fresh = hex(t.fresh);
    expect(Math.hypot(dot[0] - fresh[0], dot[1] - fresh[1], dot[2] - fresh[2])).toBeGreaterThan(150);
    // Not green: green must not lead the colour by much, so no marker reads as good or bad.
    for (const [r, g, b] of [dot, fresh]) expect(g - Math.max(r, b)).toBeLessThan(40);
  });
});
