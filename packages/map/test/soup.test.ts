// Noodle Bowl (src/map/soup.ts): what is laid round the world keeps clear of the globe, the pot, the Key and the zoom
// buttons; the broth's sway is nil at the centre, invertible, settles, and is still for reduced motion; and nothing
// moves fast enough to flash.
import { describe, expect, it } from "vitest";
import { markPath, markRing } from "../src/map/marks.ts";
import {
  bowlOf,
  GAP,
  KEY_BOX,
  noodlePoint,
  noodleReach,
  placeDisc,
  placeNoodles,
  placeRect,
  potObstacles,
  potOf,
  rimOf,
  SETTLE_S,
  STEAM_ALPHA,
  swayAmp,
  swayField,
  swayWarp,
  SWAY_HZ,
  SWAY_MIN,
  unitOf,
  Wobble,
  WISPS,
  wispAlpha,
  zoomBox,
} from "../src/map/soup.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";

const SIZES: [number, number][] = [
  [1000, 645],
  [1400, 900],
  [1920, 1000],
  [700, 400],
  [600, 900],
  [390, 300],
  [390, 520],
  [360, 440],
];
const ZOOMS = [1, 1.3, 1.6, 2.2, 4];
const globeR = (w: number, h: number, zoom: number) => Math.min(w, h) * (THEMES.soup.globeScale ?? 0.46) * zoom;

describe("Noodle Bowl", () => {
  it("is in the Design menu, in one group and not featured (decision 134)", () => {
    const t = THEMES.soup;
    expect(t.experimental).toBeFalsy();
    expect(DESIGN_GROUPS.filter((g) => g.ids.includes("soup"))).toHaveLength(1);
    expect(FEATURED).not.toContain("soup");
    expect(THEMES.soup.fresh).not.toBe(THEMES.soup.dot);
    expect(THEMES.soup.warp).toBe("wobble");
  });

  it("has a slice mark whose hollow, filled and ringed forms come from one outline", () => {
    const d = markPath("slice", 5);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).not.toContain("NaN");
    expect(markRing("slice", 5, 3)).not.toBe(d);
    expect(markPath("slice", 5)).toBe(d);
  });

  it("keeps the rim and the pot inside the frame", () => {
    for (const [w, h] of SIZES) {
      const rim = rimOf(w, h).total;
      const p = potOf(w, h);
      expect(p.x0 - rim, `${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(p.y0 - rim).toBeGreaterThanOrEqual(0);
      expect(p.x1 + rim).toBeLessThanOrEqual(w);
      expect(p.y1 + rim).toBeLessThanOrEqual(h);
      const b = bowlOf(w, h, globeR(w, h, 1));
      expect(b.r).toBeGreaterThan(globeR(w, h, 1));
      expect(b.cx - b.r - rim).toBeGreaterThanOrEqual(-1);
      expect(b.cy - b.r - rim).toBeGreaterThanOrEqual(-1);
    }
  });
});

describe("what is laid round the globe", () => {
  it("keeps every piece clear of the globe, inside the frame, off the Key and zoom corners, and apart", () => {
    let placed = 0;
    for (const [w, h] of SIZES) {
      for (const zoom of ZOOMS) {
        const R = globeR(w, h, zoom);
        const bowl = bowlOf(w, h, R);
        const zb = zoomBox(w, h);
        const list = placeDisc(w, h, w / 2, h / 2, R, bowl.r);
        list.forEach((piece, i) => {
          for (const c of piece.circles) {
            const where = `${w}x${h} zoom ${zoom} ${piece.kind}`;
            expect(Math.hypot(c[0] - w / 2, c[1] - h / 2) - c[2], where).toBeGreaterThanOrEqual(R + GAP - 1e-6);
            expect(c[0] - c[2], where).toBeGreaterThanOrEqual(0);
            expect(c[0] + c[2], where).toBeLessThanOrEqual(w);
            expect(c[1] - c[2], where).toBeGreaterThanOrEqual(0);
            expect(c[1] + c[2], where).toBeLessThanOrEqual(h);
            for (const box of [KEY_BOX, zb]) {
              const nx = Math.min(box.x1, Math.max(box.x0, c[0])), ny = Math.min(box.y1, Math.max(box.y0, c[1]));
              expect(Math.hypot(c[0] - nx, c[1] - ny), `${where}: on the Key or zoom corner`).toBeGreaterThanOrEqual(c[2]);
            }
            for (const other of list.slice(0, i)) for (const q of other.circles) expect(Math.hypot(c[0] - q[0], c[1] - q[1]), `${where}: over ${other.kind}`).toBeGreaterThanOrEqual(c[2] + q[2]);
            placed++;
          }
        });
      }
    }
    expect(placed).toBeGreaterThan(0);
  });

  it("lays the eggs, the spoon and the greens in a desktop bowl, and nothing where there is no room", () => {
    const [w, h] = [1000, 645];
    const R = globeR(w, h, 1);
    const kinds = placeDisc(w, h, w / 2, h / 2, R, bowlOf(w, h, R).r).map((p) => p.kind);
    for (const k of ["spoon", "egg", "scallion", "sprig", "nori"]) expect(kinds, k).toContain(k);
    // Zoomed in so the globe fills the frame, there is no free bowl left.
    const Rz = globeR(w, h, 4);
    expect(placeDisc(w, h, w / 2, h / 2, Rz, bowlOf(w, h, Rz).r)).toEqual([]);
  });

  it("places the same pieces for the same frame", () => {
    const R = globeR(1400, 900, 1);
    const a = placeDisc(1400, 900, 700, 450, R, bowlOf(1400, 900, R).r);
    expect(placeDisc(1400, 900, 700, 450, R, bowlOf(1400, 900, R).r)).toEqual(a);
    expect(placeRect(1400, 900)).toEqual(placeRect(1400, 900));
  });

  it("keeps every noodle, its whole body and its curls, between the globe's gap and the bowl's rim", () => {
    let seen = 0;
    for (const [w, h] of SIZES) {
      for (const zoom of ZOOMS) {
        const R = globeR(w, h, zoom);
        const bowl = bowlOf(w, h, R);
        for (const n of placeNoodles(w, h, R, bowl.r)) {
          const [lo, hi] = noodleReach(n);
          expect(lo, `${w}x${h} zoom ${zoom}`).toBeGreaterThanOrEqual(R + GAP - 1e-6);
          expect(hi).toBeLessThanOrEqual(bowl.r - 6 + 1e-6);
          // The curve itself, sampled, stays inside the reach that was checked: the curl moves it round the bowl only.
          for (let i = 0; i <= 200; i++) {
            const [x, y] = noodlePoint(n, i / 200, w / 2, h / 2);
            const r = Math.hypot(x - w / 2, y - h / 2);
            expect(r - n.width / 2).toBeGreaterThanOrEqual(R + GAP - 1e-6);
            expect(r + n.width / 2).toBeLessThanOrEqual(bowl.r - 6 + 1e-6);
          }
          seen++;
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("keeps Map view's pieces outside the pot's rim and handles, and leaves them out on a narrow frame", () => {
    let placed = 0;
    for (const [w, h] of SIZES) {
      const list = placeRect(w, h);
      if (w < 700) expect(list).toEqual([]);
      const { box, handles } = potObstacles(w, h);
      const zb = zoomBox(w, h);
      for (const piece of list) {
        for (const c of piece.circles) {
          const nx = Math.min(box.x1, Math.max(box.x0, c[0])), ny = Math.min(box.y1, Math.max(box.y0, c[1]));
          expect(Math.hypot(c[0] - nx, c[1] - ny), `${w}x${h} ${piece.kind}`).toBeGreaterThanOrEqual(c[2]);
          for (const q of handles) expect(Math.hypot(c[0] - q[0], c[1] - q[1])).toBeGreaterThanOrEqual(c[2] + q[2]);
          expect(c[0] - c[2]).toBeGreaterThanOrEqual(0);
          expect(c[0] + c[2]).toBeLessThanOrEqual(w);
          expect(c[1] - c[2]).toBeGreaterThanOrEqual(0);
          expect(c[1] + c[2]).toBeLessThanOrEqual(h);
          const mx = Math.min(zb.x1, Math.max(zb.x0, c[0])), my = Math.min(zb.y1, Math.max(zb.y0, c[1]));
          expect(Math.hypot(c[0] - mx, c[1] - my)).toBeGreaterThanOrEqual(c[2]);
          placed++;
        }
      }
    }
    expect(placed).toBeGreaterThan(0);
  });

  it("sizes the pieces from the frame, never below half or above a quarter more than a desktop's", () => {
    expect(unitOf(390, 300)).toBe(0.5);
    expect(unitOf(1000, 645)).toBeCloseTo(1, 1);
    expect(unitOf(3000, 2000)).toBe(1.25);
  });
});

describe("the broth's sway", () => {
  const frames: [number, number][] = [[1000, 645], [1400, 900], [390, 300], [390, 520]];

  it("leaves the centre alone, so the tuned place stays under the reticle", () => {
    for (const [w, h] of frames) {
      const wp = swayWarp(w, h, swayAmp(w, h), 1.3);
      expect(wp.fwd(w / 2, h / 2)).toEqual([w / 2, h / 2]);
      // Close to the centre it moves less than a tenth of a pixel, so a tap there lands on the place under it.
      const [x, y] = wp.fwd(w / 2 + 2, h / 2 + 2);
      expect(Math.hypot(x - w / 2 - 2, y - h / 2 - 2)).toBeLessThan(0.1);
    }
  });

  it("can be undone to a hundredth of a pixel anywhere in the frame, at full strength and every phase", () => {
    for (const [w, h] of frames) {
      for (const phase of [0, 0.9, 2.2, 4, 5.5]) {
        const wp = swayWarp(w, h, swayAmp(w, h), phase);
        for (let x = 0; x <= w; x += w / 14) {
          for (let y = 0; y <= h; y += h / 11) {
            const [sx, sy] = wp.fwd(x, y);
            const [bx, by] = wp.inv(sx, sy);
            expect(Math.hypot(bx - x, by - y), `${w}x${h} phase ${phase} at ${x.toFixed(0)},${y.toFixed(0)}`).toBeLessThan(0.01);
          }
        }
      }
    }
  });

  it("bends gently: the field's slope stays under 0.85 so the picture never folds, and no point moves more than 3 amplitudes", () => {
    for (const [w, h] of frames) {
      const amp = swayAmp(w, h);
      for (const phase of [0, 1.1, 2.9, 4.4]) {
        const d = swayField(w, h, amp, phase);
        for (let x = 4; x < w; x += w / 12) {
          for (let y = 4; y < h; y += h / 9) {
            const e = 0.5;
            const [ax, ay] = d(x + e, y), [bx, by] = d(x - e, y), [cx, cy] = d(x, y + e), [dx, dy] = d(x, y - e);
            const jx = Math.hypot((ax - bx) / (2 * e), (ay - by) / (2 * e)), jy = Math.hypot((cx - dx) / (2 * e), (cy - dy) / (2 * e));
            expect(Math.max(jx, jy)).toBeLessThan(0.85);
            const [mx, my] = d(x, y);
            expect(Math.hypot(mx, my)).toBeLessThan(3 * amp);
          }
        }
      }
    }
  });

  it("swings under three times a second, so it cannot flash", () => {
    expect(SWAY_HZ).toBeLessThanOrEqual(2);
    // The fastest the field moves a point is amp * 2 pi * rate * 1.3 pixels a second: well under a screen width.
    expect(swayAmp(1400, 900) * 2 * Math.PI * SWAY_HZ * 1.3).toBeLessThan(200);
  });

  /** Steps the wobble through a drag of `drag` pixels a second for `s` seconds, then holds still, at 60 frames a second. */
  const run = (drag: number, s: number, still = false) => {
    const wob = new Wobble();
    let now = 1000;
    let lon = 10;
    wob.step(now, lon, 0, 1, 300, 1000, 645, still);
    let warp = null as ReturnType<Wobble["step"]>;
    for (let i = 0; i < Math.round(s * 60); i++) {
      now += 1000 / 60;
      lon += ((drag / 60) / 300) / (Math.PI / 180);
      warp = wob.step(now, lon, 0, 1, 300, 1000, 645, still);
    }
    return { wob, warp, now, lon };
  };

  it("stirs under a drag, never past full, and a slow drift does not", () => {
    const fast = run(900, 0.5);
    expect(fast.wob.energy).toBeGreaterThan(0.9);
    expect(fast.wob.energy).toBeLessThanOrEqual(1);
    expect(fast.warp).not.toBeNull();
    const slow = run(10, 0.5);
    expect(slow.wob.energy).toBe(0);
    expect(slow.warp).toBeNull();
  });

  it("settles within three seconds of letting go, and is gone by then", () => {
    const { wob, now, lon } = run(900, 0.5);
    let t = now;
    let steps = 0;
    let warp: ReturnType<Wobble["step"]> = null;
    do {
      t += 1000 / 60;
      warp = wob.step(t, lon, 0, 1, 300, 1000, 645, false);
      steps++;
    } while (warp && steps < 600);
    expect(steps / 60).toBeLessThan(3);
    expect(wob.energy).toBe(0);
    // Its fall is the one the constants say: from 1 to the floor in SETTLE_S * ln(1 / SWAY_MIN) seconds.
    expect(steps / 60).toBeLessThan(SETTLE_S * Math.log(1 / SWAY_MIN) + 0.1);
  });

  it("never stirs for reduced motion, however hard the view moves", () => {
    const r = run(2000, 1, true);
    expect(r.warp).toBeNull();
    expect(r.wob.energy).toBe(0);
    expect(r.wob.active).toBe(false);
  });

  it("starts still after a long pause, as in a tab that was hidden", () => {
    const { wob, now, lon } = run(900, 0.3);
    expect(wob.step(now + 60_000, lon + 40, 0, 1, 300, 1000, 645, false)).toBeNull();
  });
});

describe("the steam", () => {
  it("never swings more than a tenth in a third of a second", () => {
    for (const wp of WISPS) {
      expect(wp.period).toBeGreaterThanOrEqual(8);
      for (let t = 0; t < 120; t += 1 / 12) {
        expect(Math.abs(wispAlpha(wp, t + 1 / 3) - wispAlpha(wp, t))).toBeLessThan(0.1);
        expect(wispAlpha(wp, t)).toBeLessThanOrEqual(STEAM_ALPHA + 1e-9);
      }
    }
  });
});
