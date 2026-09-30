// Spreadsheet's grid (decision 74): the reticle sits on one whole cell, and the column letters count as a sheet's do.
import { describe, expect, it } from "vitest";
import { columnName, sheetGrid } from "../src/map/sheet.ts";

describe("spreadsheet grid", () => {
  it("names columns A to Z, then AA on", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });

  for (const [w, h] of [
    [1030, 660],
    [390, 420],
    [777, 501],
  ] as const) {
    it(`centres a cell on the frame's centre at ${w} by ${h}`, () => {
      const g = sheetGrid(w, h);
      const ci = Math.floor((w / 2 - g.x0) / g.cw);
      const cj = Math.floor((h / 2 - g.y0) / g.ch);
      expect(g.x0 + (ci + 0.5) * g.cw).toBeCloseTo(w / 2, 6);
      expect(g.y0 + (cj + 0.5) * g.ch).toBeCloseTo(h / 2, 6);
      expect(g.x0).toBeLessThanOrEqual(0);
      expect(g.x0 + g.cols * g.cw).toBeGreaterThanOrEqual(w);
      expect(g.y0 + g.rows * g.ch).toBeGreaterThanOrEqual(h);
    });
  }
});
