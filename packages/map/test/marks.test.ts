// Every marker shape is one closed outline, sized like a circle of the same radius (decision 72).
import { describe, expect, it } from "vitest";
import { markPath, type MarkShape } from "../src/map/marks.ts";

const SHAPES: MarkShape[] = ["circle", "square", "diamond", "bevel", "hex", "pad", "star4", "star5", "star6", "flower", "gumdrop", "shield"];

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
});
