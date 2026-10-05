// Shortwave (src/map/shortwave.ts, src/ui/dial.ts, src/ui/dialsound.ts): a design in the menu
// (decision 134); its radio front under the map shows only in this design; the dial's needle and the longitude it stands
// for agree both ways; the printed scale fits the window; the tuning knob's detents and flywheel always come to rest
// in a detent; the eye follows the reticle's nearness to a place the same for every place; the bands and the time knob
// map to the map's levels and the time bar's slots; and nothing on it flashes (WCAG 2.3.1).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  angleOfSlot,
  atRest,
  BAND_COUNT,
  bandOf,
  bandStep,
  CLICK_GAP_MS,
  DETENT_DEG,
  DETENT_SOFT,
  detentAt,
  detentStep,
  dialAt,
  EYE_OPEN,
  EYE_SHUT,
  flick,
  FLY_MAX_DEG_S,
  LABEL_PX,
  LAMP_DIM,
  LAMP_LIT,
  lampLevel,
  LOCK_FAR,
  LOCK_NEAR,
  LOCK_TAU_S,
  lockOf,
  lonAt,
  lonText,
  needleJumps,
  scaleLabels,
  scaleStep,
  sectorPath,
  SLOT_DEG,
  SLOTS,
  slotOfAngle,
  smoothLock,
  spinStep,
  STATIC_DRIFT_S,
  STATIC_OPACITY,
  turnBetween,
  WING_TURN,
  wingAt,
} from "../src/map/shortwave.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";
import { cssFor } from "./css.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const css = cssFor("shortwave").replace(/\/\*[\s\S]*?\*\//g, "");
const dial = readFileSync(here("../src/ui/dial.ts"), "utf8");
const sound = readFileSync(here("../src/ui/dialsound.ts"), "utf8");

describe("Shortwave", () => {
  it("is in the Design menu, in one group and not featured (decision 134)", () => {
    const t = THEMES.shortwave;
    expect(t.experimental).toBeFalsy();
    expect(DESIGN_GROUPS.filter((g) => g.ids.includes("shortwave"))).toHaveLength(1);
    expect(FEATURED).not.toContain("shortwave");
    expect(FEATURED).not.toContain("shortwave");
  });

  it("keeps hollow, filled, ringed and fresh markers apart", () => {
    const t = THEMES.shortwave;
    expect(t.fresh).not.toBe(t.dot);
    expect(t.dotStroke).not.toBe(t.dot);
    expect(t.dotShape).toBe("circle");
  });

  it("shows the radio under the map in this design only", () => {
    // Every rule that names the radio on its own (not a part inside it), with what it sets.
    const rules = [...css.matchAll(/([^{}]*\.sw-radio(?![\w-])[^{}]*)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
    const base = rules.filter((r) => r.sel === ".sw-radio");
    expect(base).toHaveLength(1);
    expect(base[0]!.body).toMatch(/display:\s*none/);
    for (const r of rules) {
      if (/display:\s*(?!none)\w/.test(r.body)) expect(r.sel, r.sel).toContain(':root[data-theme="shortwave"]');
    }
  });

  it("lays the static over the dial window only, never over the map", () => {
    const rules = [...css.matchAll(/([^{}]*\.sw-static[^{}]*)\{([^}]*)\}/g)].map((m) => m[1]!.trim());
    expect(rules.length).toBeGreaterThan(0);
    for (const sel of rules) expect(sel).not.toMatch(/\.map\b/);
    // Positioned inside the glass, which clips it.
    expect(css).toMatch(/\.sw-glass\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.sw-static\s*\{[^}]*position:\s*absolute/);
  });
});

describe("Shortwave's dial", () => {
  it("runs from 180 W at the left end to 180 E at the right, with 0 in the middle", () => {
    expect(dialAt(-180)).toBe(0);
    expect(dialAt(0)).toBe(0.5);
    expect(dialAt(90)).toBe(0.75);
    expect(lonAt(0)).toBe(-180);
    expect(lonAt(1)).toBe(180);
    expect(lonAt(-0.5)).toBe(-180);
    expect(lonAt(2)).toBe(180);
  });

  it("puts the needle where the longitude is, and back again, for every longitude", () => {
    for (let lon = -179.5; lon < 180; lon += 7.3) {
      const f = dialAt(lon);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      expect(lonAt(f)).toBeCloseTo(lon, 9);
    }
    // A longitude past the date line wraps to its place on the scale.
    expect(dialAt(190)).toBeCloseTo(dialAt(-170), 12);
    expect(dialAt(-200)).toBeCloseTo(dialAt(160), 12);
  });

  it("prints its numbers far enough apart to read, on a phone and on a wide screen", () => {
    for (const w of [180, 220, 260, 320, 480, 650, 900]) {
      const step = scaleStep(w);
      const labels = scaleLabels(step);
      expect(labels[0]!.lon).toBe(-180);
      expect(labels.at(-1)!.lon).toBe(180);
      if ((w * 90) / 360 >= LABEL_PX) expect((w * step) / 360).toBeGreaterThanOrEqual(LABEL_PX);
    }
    expect(scaleStep(650)).toBe(30);
    expect(scaleStep(260)).toBe(60);
  });

  it("prints longitude like a band's frequencies: numbers with W or E, and no names", () => {
    const labels = scaleLabels(30);
    expect(labels.map((l) => l.num + l.side)).toEqual(["180", "150W", "120W", "90W", "60W", "30W", "0", "30E", "60E", "90E", "120E", "150E", "180"]);
    for (const l of labels) expect(l.num).toMatch(/^\d+$/);
    expect(lonText(36.82)).toBe("36.8 degrees east");
    expect(lonText(-77)).toBe("77 degrees west");
    expect(lonText(0)).toBe("0 degrees");
  });

  it("turns the knob the short way round across the date line", () => {
    expect(turnBetween(170, -170)).toBe(20);
    expect(turnBetween(-170, 170)).toBe(-20);
    expect(turnBetween(10, 40)).toBe(30);
    expect(Math.abs(turnBetween(0, 180))).toBe(180);
  });

  it("lets the needle ease a little but never whip across the dial", () => {
    expect(needleJumps(0.5, 0.52)).toBe(false);
    expect(needleJumps(0.98, 0.02)).toBe(true);
    expect(needleJumps(0.2, 0.9)).toBe(true);
  });
});

describe("Shortwave's tuning knob", () => {
  it("is a little sticky at each detent and never turns backwards under the hand", () => {
    expect(DETENT_SOFT).toBeGreaterThan(0);
    expect(DETENT_SOFT).toBeLessThan(1);
    for (let angle = -50; angle <= 50; angle += 0.7) expect(detentStep(angle, 1)).toBeGreaterThan(0);
    // Slowest at a detent's centre, quickest halfway between two.
    expect(detentStep(0, 1)).toBeCloseTo(1 - DETENT_SOFT, 9);
    expect(detentStep(DETENT_DEG / 2, 1)).toBeCloseTo(1 + DETENT_SOFT, 9);
    // Over many detents the knob keeps up with the hand to within the stickiness (it lags by sqrt(1 - soft squared)),
    // so it stays under the finger and never runs ahead of it.
    let knob = 0;
    for (let hand = 0; hand < DETENT_DEG * 20; hand += 0.01) knob += detentStep(knob, 0.01);
    expect(knob).toBeCloseTo(DETENT_DEG * 20 * Math.sqrt(1 - DETENT_SOFT ** 2), 0);
    expect(knob).toBeLessThan(DETENT_DEG * 20);
    expect(detentAt(14)).toBe(1);
    expect(detentAt(-26)).toBe(-3);
  });

  it("let go while turning, spins on and always comes to rest exactly in a detent", () => {
    for (const speed of [-FLY_MAX_DEG_S, -400, -90, -20, 0, 15, 70, 200, 500, FLY_MAX_DEG_S]) {
      for (const angle of [-13.3, 0, 2.2, 5.01, 7.9, 91.1]) {
        let s = { angle, speed };
        let t = 0;
        while (!atRest(s) && t < 8) {
          s = spinStep(s, 0.004);
          t += 0.004;
        }
        expect(atRest(s), `${speed} from ${angle}`).toBe(true);
        // Settled well within two seconds, even from the hardest throw.
        expect(t).toBeLessThan(2);
        // And never further than the throw's own run, which friction sets, plus a detent.
        expect(Math.abs(s.angle - angle)).toBeLessThanOrEqual(Math.abs(speed) / 2.4 + DETENT_DEG);
      }
    }
  });

  it("a hard flick runs on for some turns of the knob and a gentle one for a few detents", () => {
    const run = (speed: number) => {
      let s = { angle: 0, speed };
      let t = 0;
      while (!atRest(s) && t < 8) {
        s = spinStep(s, 0.004);
        t += 0.004;
      }
      return Math.abs(s.angle);
    };
    expect(run(FLY_MAX_DEG_S)).toBeGreaterThan(200);
    expect(run(200)).toBeGreaterThan(DETENT_DEG);
    expect(run(200)).toBeLessThan(80);
    // A throw is kept to what the knob may spin at.
    expect(flick(5000)).toBe(FLY_MAX_DEG_S);
    expect(flick(-5000)).toBe(-FLY_MAX_DEG_S);
    expect(flick(120)).toBe(120);
  });

  it("clicks no more often than the sound allows", () => {
    expect(CLICK_GAP_MS).toBeGreaterThanOrEqual(16);
  });
});

describe("Shortwave's eye and static follow the reticle's nearness to a place", () => {
  it("is shut for a tuned place, open with none near, and the same for every place", () => {
    expect(lockOf(null, false)).toBe(0);
    expect(lockOf(5, true)).toBe(1);
    expect(lockOf(LOCK_NEAR, false)).toBe(1);
    expect(lockOf(LOCK_FAR, false)).toBe(0);
    expect(lockOf(LOCK_FAR + 500, false)).toBe(0);
    // Nearer is never less closed, and it takes only the distance and whether one is tuned: no place, size or story.
    let last = 0;
    for (let d = LOCK_FAR; d >= 0; d -= 3) {
      const v = lockOf(d, false);
      expect(v).toBeGreaterThanOrEqual(last);
      expect(v).toBeLessThanOrEqual(1);
      last = v;
    }
    expect(lockOf.length).toBe(2);
  });

  it("closes the wedge to a sliver and no further, and glows between its two levels", () => {
    expect(EYE_OPEN - 2 * WING_TURN).toBe(EYE_SHUT);
    expect(EYE_SHUT).toBeGreaterThan(0);
    expect(wingAt(0)).toBe(0);
    expect(wingAt(1)).toBe(WING_TURN);
    expect(wingAt(7)).toBe(WING_TURN);
    expect(lampLevel(0)).toBe(LAMP_DIM);
    expect(lampLevel(1)).toBe(LAMP_LIT);
    expect(sectorPath(-45, 45)).toMatch(/^M20 20L[\d.]+ [\d.]+A17 17 0 0 1 [\d.]+ [\d.]+Z$/);
  });

  it("is smoothed so places passing in quick succession can't make it blink", () => {
    // The worst case: the nearest place coming and going as often and as hard as it can.
    const dt = 1 / 120;
    for (const hz of [3, 4, 6, 10, 30]) {
      let level = 0;
      const seen: number[] = [];
      for (let i = 0; i < 120 * 4; i++) {
        const target = Math.floor(i * dt * hz * 2) % 2 === 0 ? 1 : 0;
        level = smoothLock(level, target, dt);
        seen.push(level);
      }
      // Over any third of a second the level moves by under a third of its range once it has settled into the beat.
      const win = Math.round(120 / 3);
      let worst = 0;
      for (let i = 240; i + win < seen.length; i++) {
        const part = seen.slice(i, i + win);
        worst = Math.max(worst, Math.max(...part) - Math.min(...part));
      }
      expect(worst, `${hz} Hz`).toBeLessThan(0.34);
    }
    expect(LOCK_TAU_S).toBeGreaterThanOrEqual(0.25);
    expect(smoothLock(0, 1, 100)).toBeCloseTo(1, 9);
    expect(smoothLock(0.4, 0.4, 0.1)).toBeCloseTo(0.4, 9);
  });

  it("the static is faint, drifts slowly at an even light and thins with the eye's wedge rather than cutting", () => {
    expect(STATIC_OPACITY).toBeLessThanOrEqual(0.5);
    expect(STATIC_DRIFT_S).toBeGreaterThanOrEqual(8);
    expect(css).toMatch(/\.sw-static\s*\{[^}]*opacity:\s*calc\(var\(--sw-static[^}]*var\(--sw-lock/);
    // The drift is a plain slide of a tiling texture, linear, never stepped, so no frame is lighter than the last.
    expect(css).toMatch(/\.sw-static::before\s*\{[^}]*animation:\s*sw-drift[^;]*linear infinite/);
    // And it holds still for reduced motion.
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^@]*\.sw-static::before\s*\{\s*animation:\s*none/);
  });

  it("the clack moves the needle and the eye and changes no light, and reduced motion drops it", () => {
    const clack = [...css.matchAll(/@keyframes sw-(clack|thump)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[2]!);
    expect(clack).toHaveLength(2);
    for (const body of clack) {
      expect(body).toMatch(/transform/);
      expect(body).not.toMatch(/opacity|color|background|filter|shadow/);
    }
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.sw-radio\.clack \.sw-needle[\s\S]*?animation:\s*none/);
  });
});

describe("Shortwave's bands and time knob", () => {
  it("has a band key for each of the map's zoom levels and keeps to them", () => {
    expect(BAND_COUNT).toBe(5);
    expect(bandOf(-1)).toBe(0);
    expect(bandOf(2)).toBe(2);
    expect(bandOf(9)).toBe(BAND_COUNT - 1);
    expect(bandStep(0, -1)).toBe(0);
    expect(bandStep(0, 1)).toBe(1);
    expect(bandStep(BAND_COUNT - 1, 1)).toBe(BAND_COUNT - 1);
    expect(bandStep(3, -1)).toBe(2);
  });

  it("puts one detent on each of the time bar's quarter hours, a turn and a half for the day", () => {
    expect(SLOTS).toBe(96);
    expect(SLOT_DEG * SLOTS).toBe(540);
    for (let slot = 0; slot <= SLOTS; slot++) expect(slotOfAngle(angleOfSlot(slot))).toBe(slot);
    expect(slotOfAngle(-30)).toBe(0);
    expect(slotOfAngle(9999)).toBe(SLOTS);
    expect(slotOfAngle(angleOfSlot(10) + SLOT_DEG * 0.4)).toBe(10);
  });

  it("moves the time bar's own slider, so it is one control and not a second copy of the time", () => {
    expect(dial).toMatch(/slider\.dispatchEvent\(new Event\("input"/);
  });
});

describe("Shortwave's front keeps to the neutrality and motion rules", () => {
  it("has no sound until the reader asks, and plays none in a hidden tab", () => {
    expect(sound).toMatch(/let on = false/);
    expect(sound).toMatch(/document\.hidden/);
    // The only way it comes on is the Sound key's click handler; nothing calls it at load.
    expect(dial.match(/setSound\(/g)).toHaveLength(1);
    expect(dial).toMatch(/sound\.addEventListener\("click"[\s\S]*setSound\(!soundOn\(\)\)/);
  });

  it("runs nothing in a hidden tab and nothing at all for reduced motion", () => {
    expect(dial).toMatch(/visibilitychange/);
    expect(dial).toMatch(/prefers-reduced-motion: reduce/);
    // The eye shows only whether a place is tuned for reduced motion.
    expect(dial).toMatch(/aimLock\(reduced\(\) \? \(tuned \? 1 : 0\)/);
  });

  it("prints no station, place or country names on the dial: only numbers and W or E", () => {
    for (const l of scaleLabels(30)) expect(l.num + l.side).toMatch(/^\d+[WE]?$/);
    expect(dial).not.toMatch(/innerHTML/);
  });

  it("never puts a style attribute in markup", () => {
    expect(dial).not.toMatch(/setAttribute\(["']style/);
    expect(dial).not.toMatch(/style=/);
  });
});
