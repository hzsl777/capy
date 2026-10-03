// Primary (src/map/stijl.ts): an experimental design that stays off the Design menu. Its coloured rectangles are
// chosen by where they are and nothing else, stay sparse and broad, never come as a small piece a marker could be
// mistaken for, and the composition's rectangles are the same wherever the view starts. Nothing moves.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { geoArea } from "d3-geo";
import { describe, expect, it } from "vitest";
import { ambientDelay } from "../src/map/ambient.ts";
import {
  cellFill,
  cellRing,
  colourFits,
  gridInView,
  keepLine,
  latCount,
  linesIn,
  LONG_COLOUR_PX,
  lonCount,
  MIN_COLOUR_PX,
  PRIMARIES,
  segmentDrawn,
  solidLand,
  stepOf,
  type StijlCell,
  viewSpan,
} from "../src/map/stijl.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";

const WORLD = { lon: 180, lat: 90 };
const key = (level: number, c: StijlCell) => `${((c.i % lonCount(level)) + lonCount(level)) % lonCount(level)}:${c.j}`;

describe("Primary", () => {
  it("is experimental, so it opens only from a link and stays off the Design menu", () => {
    const t = THEMES.stijl;
    expect(t.experimental).toBe(true);
    expect(DESIGN_GROUPS.flatMap((g) => g.ids)).not.toContain("stijl");
    expect(FEATURED).not.toContain("stijl");
    expect(t.surface).toBe("stijl");
  });

  it("keeps markers round, edged in white and apart from fresh reports, so none reads as a cell", () => {
    const t = THEMES.stijl;
    expect(t.dotShape).toBe("circle");
    expect(t.dotStroke).toBe("#ffffff");
    expect(t.fresh).not.toBe(t.dot);
    // A pinned place gets a ring, not a square frame that would read as one more rectangle.
    expect(t.pinRing).toBe(true);
  });

  it("holds still: no motion and no frames of its own", () => {
    const t = THEMES.stijl;
    expect(t.motion).toBeFalsy();
    expect(t.scene).toBeUndefined();
    expect(ambientDelay(t)).toBe(0);
  });

  it("chooses a cell's fill from its position alone, the same on every call and round the wrap", () => {
    let differ = 0;
    for (let level = 0; level <= 5; level++) {
      const n = lonCount(level);
      for (let i = -n; i < 2 * n; i++) {
        for (let j = 0; j < latCount(level); j++) {
          const f = cellFill(level, i, j, 3, 2);
          if (cellFill(level, i, j, 3, 2) !== f || cellFill(level, i + n, j, 3, 2) !== f) differ++;
        }
      }
    }
    expect(differ).toBe(0);
  });

  it("reads nothing about the news: the drawing imports only geometry and the basemap's type", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/map/stijl.ts", import.meta.url)), "utf8");
    const imports = [...src.matchAll(/^import[^;]*from "([^"]+)";/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./basemap.ts", "./surface.ts", "d3-geo"]);
    expect(src).toMatch(/^import type \{ Basemap \} from "\.\/basemap\.ts";/m);
  });

  it("cuts the same rectangles with the same fills wherever the view is centred", () => {
    for (const level of [2, 3, 5, 7]) {
      const span = { lon: 40 * stepOf(level), lat: 20 * stepOf(level) };
      const seen = new Map<string, string>();
      for (const [lon, lat] of [[0, 0], [17.3, 4.1], [-170, -30], [175, 50], [92, -8]] as const) {
        for (const c of gridInView(level, lon, lat, span).cells) {
          const k = key(level, c);
          const v = `${c.wide}x${c.tall}:${c.fill}`;
          if (seen.has(k)) expect(v, `${level} ${k}`).toBe(seen.get(k));
          else seen.set(k, v);
        }
      }
    }
  });

  it("never makes land red, and keeps colour sparse, broad and evenly spread between yellow and blue", () => {
    expect(PRIMARIES).not.toContain("red");
    const counts: Record<string, number> = { white: 0, grey: 0, yellow: 0, blue: 0 };
    let all = 0;
    let narrow = 0;
    for (let level = 1; level <= 6; level++) {
      for (const c of gridInView(level, 0, 0, WORLD).cells) {
        all++;
        counts[c.fill]!++;
        if (PRIMARIES.includes(c.fill) && c.wide * c.tall < 2) narrow++;
      }
    }
    expect(narrow).toBe(0);
    expect(Object.keys(counts).sort()).toEqual(["blue", "grey", "white", "yellow"]);
    const coloured = counts.yellow! + counts.blue!;
    expect(coloured / all).toBeLessThan(0.26);
    expect(coloured / all).toBeGreaterThan(0.08);
    for (const p of PRIMARIES) expect(counts[p]! / coloured).toBeGreaterThan(0.4);
    // Most of the land stays white or light grey.
    expect(counts.white! / all).toBeGreaterThan(0.55);
  });

  it("runs every fourth line through, never leaves out every eighth meridian, and keeps rectangles within eight units", () => {
    const bad: string[] = [];
    for (let level = 0; level <= 6; level++) {
      for (let i = 0; i < lonCount(level); i += 4) if (!keepLine(0, level, i)) bad.push(`meridian ${level}/${i}`);
      for (let j = 0; j <= latCount(level); j += 4) if (!keepLine(1, level, j)) bad.push(`parallel ${level}/${j}`);
      for (let i = 0; i < lonCount(level); i += 8) for (let j = 0; j < latCount(level); j++) if (!segmentDrawn(level, i, j)) bad.push(`piece ${level}/${i}/${j}`);
      for (const c of gridInView(level, 30, 10, WORLD).cells) if (c.wide <= 0 || c.wide > 8 || c.tall <= 0 || c.tall > 4) bad.push(`cell ${level}/${c.i}/${c.j}`);
    }
    expect(bad).toEqual([]);
    // The lines in view start and end on whole eighths, so the first and last rectangles are whole.
    const xs = linesIn(0, 4, 13.2, 41.7);
    expect(xs[0]! % 8).toBe(0);
    expect(xs[xs.length - 1]! % 8).toBe(0);
  });

  it("lays out the whole world with no gaps: every row's rectangles meet end to end", () => {
    const level = 3;
    const grid = gridInView(level, 0, 0, WORLD);
    const rows = new Map<number, StijlCell[]>();
    for (const c of grid.cells) rows.set(c.j, [...(rows.get(c.j) ?? []), c]);
    for (const row of rows.values()) {
      for (let k = 1; k < row.length; k++) expect(row[k]!.i).toBe(row[k - 1]!.i + row[k - 1]!.wide);
      const span = row.reduce((s, c) => s + c.wide, 0);
      expect(span).toBeGreaterThanOrEqual(lonCount(level));
    }
  });

  it("winds each cell so it covers its own small box, not the rest of the sphere", () => {
    for (const [a, b, c, d] of [[-10, 12, -5, 7], [170, 181.25, 60, 67.5], [-180, -135, -90, -45]] as const) {
      const area = geoArea({ type: "Polygon", coordinates: [cellRing(a, b, c, d)] });
      expect(area).toBeGreaterThan(0);
      expect(area).toBeLessThan(Math.PI);
    }
  });

  it("paints colour only on solid land, never where any part of the cell or its margin is sea or lake", () => {
    // A square continent from 0 to 40 east and 0 to 30 north.
    const land = (lon: number, lat: number) => lon >= 0 && lon <= 40 && lat >= 0 && lat <= 30;
    expect(solidLand(land, 5, 15, 5, 15)).toBe(true);
    expect(solidLand(land, 30, 40, 5, 15)).toBe(false);
    expect(solidLand(land, -5, 5, 5, 15)).toBe(false);
    // A lake inside the cell, smaller than the sample spacing of the land raster, is still found.
    const lake = (lon: number, lat: number) => land(lon, lat) && !(Math.abs(lon - 10.2) < 0.3 && Math.abs(lat - 10.2) < 0.3);
    expect(solidLand(lake, 5, 15, 5, 15)).toBe(false);
  });

  it("paints colour only where the rectangle is longer than the largest marker", () => {
    // The largest marker: 13 pixels times 1.45 at the closest zoom, a 2.6 pixel gap and its ring's line.
    const largest = 2 * (13 * 1.45 + 2.6 + 1.3);
    expect(LONG_COLOUR_PX).toBeGreaterThan(largest);
    expect(colourFits(MIN_COLOUR_PX, LONG_COLOUR_PX)).toBe(true);
    expect(colourFits(30, 30)).toBe(false);
    expect(colourFits(MIN_COLOUR_PX - 1, 200)).toBe(false);
  });

  it("covers the view: on the globe the whole near side when it fits, and in Map view the frame", () => {
    expect(viewSpan(1000, 600, "3d", 250, 0)).toEqual({ lon: 180, lat: 90 });
    const near = viewSpan(1000, 600, "3d", 4000, 10);
    expect(near.lat).toBeLessThan(15);
    expect(near.lon).toBeLessThan(20);
    const flat = viewSpan(1000, 600, "2d", 1000, 0);
    expect(flat.lon).toBeGreaterThan(500 / ((1000 * Math.PI) / 180));
  });
});
