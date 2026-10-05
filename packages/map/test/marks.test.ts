// Every marker shape is one closed outline, sized like a circle of the same radius (decision 72).
import { describe, expect, it } from "vitest";
import { beanCrease, markPath, markRing, type MarkShape } from "../src/map/marks.ts";

const SHAPES: MarkShape[] = ["circle", "square", "diamond", "bevel", "hex", "pad", "star4", "star5", "star6", "flower", "gumdrop", "shield", "block", "shell", "squircle", "house", "loop", "x", "pin", "ticket", "stub", "teacup", "nugget", "cube", "bean"];

describe("marker shapes", () => {
  for (const s of SHAPES) {
    it(`${s} is one closed outline within twice its radius`, () => {
      const d = markPath(s, 6);
      expect(d.startsWith("M")).toBe(true);
      expect(d.endsWith("Z")).toBe(true);
      expect(d.match(/M/g)).toHaveLength(1);
      const nums = (d.match(/-?\d+\.?\d*/g) ?? []).map(Number).filter((n) => Math.abs(n) !== 1 && n !== 0);
      expect(Math.max(...nums.map(Math.abs))).toBeLessThanOrEqual(12);
    });
  }

  it("rings the X with a circle clear of its corners, and every other shape with its own outline", () => {
    const corners = (markPath("x", 6).match(/-?\d+\.?\d*/g) ?? []).map(Number);
    let reach = 0;
    for (let i = 0; i < corners.length; i += 2) reach = Math.max(reach, Math.hypot(corners[i]!, corners[i + 1]!));
    const ring = Number(markRing("x", 6, 2.6).match(/A(\d+\.?\d*)/)![1]);
    expect(ring).toBeGreaterThanOrEqual(reach + 2.5);
    expect(markRing("circle", 6, 2.6)).toBe(markPath("circle", 8.6));
    expect(markRing("star4", 6, 2.6)).toBe(markPath("star4", 8.6));
    expect(markRing("bean", 6, 2.6)).toBe(markPath("bean", 8.6));
  });

  it("draws the coffee bean's crease as one open line within the bean's length", () => {
    const d = beanCrease(6);
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d.endsWith("Z")).toBe(false);
    const nums = (d.match(/-?\d+\.?\d*/g) ?? []).map(Number);
    // Its ends and its curve's handles all lie short of the bean's half length, 1.2 r, so the curve does too.
    for (let i = 0; i < nums.length; i += 2) expect(Math.hypot(nums[i]!, nums[i + 1]!)).toBeLessThan(6 * 1.2);
  });
});
