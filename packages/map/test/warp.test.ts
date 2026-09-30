// The cameras that bend the picture (decision 75): tapping a place inverts the warp, and the reticle's point never
// moves, so tuning and tapping land where the place is drawn.
import { describe, expect, it } from "vitest";
import { makeWarp, type WarpKind } from "../src/map/warp.ts";

const KINDS: WarpKind[] = ["barrel", "stadium", "desk"];

describe("picture warps", () => {
  for (const kind of KINDS) {
    for (const [w, h, globe] of [
      [1100, 780, false],
      [390, 420, false],
      [900, 700, true],
    ] as const) {
      const warp = makeWarp(kind, w, h, globe);

      it(`${kind} keeps the centre in place at ${w} by ${h}`, () => {
        const [x, y] = warp.fwd(w / 2, h / 2);
        expect(x).toBeCloseTo(w / 2, 6);
        expect(y).toBeCloseTo(h / 2, 6);
      });

      it(`${kind} inverts every point of the frame at ${w} by ${h}`, () => {
        for (let x = -40; x <= w + 40; x += w / 7)
          for (let y = -40; y <= h + 40; y += h / 7) {
            const [sx, sy] = warp.fwd(x, y);
            const [bx, by] = warp.inv(sx, sy);
            expect(Math.hypot(bx - x, by - y), `${x},${y}`).toBeLessThan(0.01);
          }
      });

      it(`${kind} turns a small drag at the centre into the same move on screen at ${w} by ${h}`, () => {
        for (const [dx, dy] of [
          [10, 0],
          [0, 10],
          [-7, 5],
        ]) {
          const [ux, uy] = warp.unpan(dx, dy);
          const [x, y] = warp.fwd(w / 2 + ux, h / 2 + uy);
          expect(Math.hypot(x - w / 2 - dx, y - h / 2 - dy)).toBeLessThan(1.5);
        }
      });
    }
  }
});
