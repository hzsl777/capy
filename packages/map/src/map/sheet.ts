// Spreadsheet (decision 74): the world as filled cells in a grid. The frame is a sheet of cells fixed to the screen,
// wider than tall, with one cell centred under the reticle (the selected cell). Land cells are filled like
// conditional formatting: a colour scale from pale near the coast to deep green inland and on mountains, with
// sand and ice cells of their own; coasts get cell borders. The sea is blank cells with gridlines. In Globe view
// the globe is a chart object on the sheet: a white box with selection handles, its plot area a disc of cells.
// The column letters and row numbers are chrome (src/ui/extras.ts), never on the canvas.

import { geoPath } from "d3-geo";
import { offscreen, type SurfaceFrame } from "./surface.ts";

export interface SheetGrid {
  cw: number;
  ch: number;
  /** Left and top edge of the first cell, at or just left of and above the frame. */
  x0: number;
  y0: number;
  cols: number;
  rows: number;
}

/** The cell grid for a frame: a cell's centre sits on the frame's centre, under the reticle. */
export function sheetGrid(w: number, h: number): SheetGrid {
  const cw = w < 560 ? 16 : 20;
  const ch = w < 560 ? 11 : 13;
  const x0 = ((((w / 2 - cw / 2) % cw) + cw) % cw) - cw;
  const y0 = ((((h / 2 - ch / 2) % ch) + ch) % ch) - ch;
  return { cw, ch, x0, y0, cols: Math.ceil((w - x0) / cw), rows: Math.ceil((h - y0) / ch) };
}

/** Column letters as a spreadsheet counts them: A to Z, then AA, AB and on. */
export function columnName(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// The colour scale, pale to deep: coast, near the coast, inland, far inland, near mountains, mountains. Never red.
const SCALE = ["#e2f0d2", "#c6e4ae", "#a6d28e", "#84bd72", "#62a05e", "#467f4b"];
const SAND = "#f4e3a1";
const ICE = "#e4ebf3";
const K_SAND = 6;
const K_ICE = 7;

export class SheetCache {
  small?: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
  chart?: { key: string; canvas: HTMLCanvasElement };
}

export function drawSheet(f: SurfaceFrame, cache: SheetCache) {
  const { ctx, w, h, proj, theme: t, mode } = f;
  const g = sheetGrid(w, h);
  const { cw, ch, x0, y0, cols, rows } = g;
  const globe = mode === "3d";
  const [gx, gy] = proj.translate();
  const R = proj.scale();

  ctx.fillStyle = t.ocean;
  ctx.fillRect(0, 0, w, h);
  // Gridlines over the whole sheet.
  const grid: string[] = [];
  for (let i = 0; i <= cols; i++) grid.push(`M${x0 + i * cw + 0.5} 0V${h}`);
  for (let j = 0; j <= rows; j++) grid.push(`M0 ${y0 + j * ch + 0.5}H${w}`);
  const gridPath = new Path2D(grid.join(""));
  ctx.lineWidth = 1;
  ctx.strokeStyle = t.waterline;
  ctx.stroke(gridPath);

  const disc = new Path2D();
  disc.arc(gx, gy, R, 0, Math.PI * 2);
  if (globe) drawChart(f, cache, gx, gy, R, false);

  // Which cells are land, and of what kind: the basemap drawn once at one pixel per cell and read back.
  if (!cache.small) {
    const canvas = document.createElement("canvas");
    cache.small = { canvas, ctx: canvas.getContext("2d", { willReadFrequently: true })! };
  }
  const { canvas: sc, ctx: sg } = cache.small;
  if (sc.width !== cols || sc.height !== rows) {
    sc.width = cols;
    sc.height = rows;
  } else sg.clearRect(0, 0, cols, rows);
  sg.setTransform(1 / cw, 0, 0, 1 / ch, -x0 / cw, -y0 / ch);
  const small = geoPath(proj, sg);
  const base = proj.scale() < 1500 ? f.low : f.map;
  sg.beginPath();
  small(base.land);
  sg.fillStyle = "#00ff00";
  sg.fill();
  sg.globalCompositeOperation = "source-atop";
  const dab = (pts: readonly [number, number][] | undefined, color: string, r: number) => {
    if (!pts) return;
    sg.fillStyle = color;
    for (const [lon, lat] of pts) {
      if (globe && !facing(f, lon, lat)) continue;
      const p = proj([lon, lat]);
      if (!p) continue;
      sg.fillRect(p[0] - r * cw, p[1] - r * ch, r * cw * 2, r * ch * 2);
    }
  };
  // Encoded in the colour channels: cyan for sand, half red near mountains, full red on them, blue for ice.
  dab(f.relief?.dunes, "#00ffff", 1.1);
  dab(f.relief?.peaks, "#80ff00", 1.8);
  dab(f.relief?.peaks, "#ffff00", 0.6);
  if (base.ice) {
    sg.beginPath();
    small(base.ice);
    sg.fillStyle = "#0000ff";
    sg.fill();
  }
  sg.globalCompositeOperation = "source-over";
  sg.setTransform(1, 0, 0, 1, 0, 0);
  const px = sg.getImageData(0, 0, cols, rows).data;

  const n = cols * rows;
  // -1 sea, 0 to 5 the colour scale, then sand and ice.
  const kind = new Int8Array(n).fill(-1);
  const hill = new Uint8Array(n);
  const inside = (i: number, j: number) => !globe || Math.hypot(x0 + (i + 0.5) * cw - gx, y0 + (j + 0.5) * ch - gy) < R - 1;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const o = (j * cols + i) * 4;
      if (px[o + 3]! < 110 || !inside(i, j)) continue;
      const r = px[o]!, gg = px[o + 1]!, b = px[o + 2]!;
      const k = j * cols + i;
      if (b > 180 && gg < 120) kind[k] = K_ICE;
      else if (b > 180) kind[k] = K_SAND;
      else {
        kind[k] = 0;
        hill[k] = r > 200 ? 2 : r > 90 ? 1 : 0;
      }
    }
  // Distance from the sea in cells, up to four: inland cells take deeper colours, as relief would.
  const dist = new Uint8Array(n).fill(255);
  const queue: number[] = [];
  for (let k = 0; k < n; k++) {
    if (kind[k]! < 0) continue;
    const i = k % cols, j = (k / cols) | 0;
    const sea = (ii: number, jj: number) => ii < 0 || jj < 0 || ii >= cols || jj >= rows || kind[jj * cols + ii]! < 0;
    if (sea(i + 1, j) || sea(i - 1, j) || sea(i, j + 1) || sea(i, j - 1)) {
      dist[k] = 0;
      queue.push(k);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q]!;
    const d = dist[k]!;
    if (d >= 4) continue;
    const i = k % cols;
    for (const m of [i + 1 < cols ? k + 1 : -1, i > 0 ? k - 1 : -1, k + cols < n ? k + cols : -1, k - cols >= 0 ? k - cols : -1]) {
      if (m < 0 || kind[m]! < 0 || dist[m]! <= d + 1) continue;
      dist[m] = d + 1;
      queue.push(m);
    }
  }

  // Filled cells, as SVG path text, one path per colour.
  const fills: string[][] = Array.from({ length: 8 }, () => []);
  const borders: string[] = [];
  const isLand = (i: number, j: number) => i >= 0 && j >= 0 && i < cols && j < rows && kind[j * cols + i]! >= 0;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      let c = kind[k]!;
      if (c < 0) continue;
      if (c === 0) {
        const d = Math.min(4, dist[k]!);
        c = hill[k] === 2 ? 5 : hill[k] === 1 ? 4 : Math.min(3, d);
      }
      const x = x0 + i * cw + 1, y = y0 + j * ch + 1;
      fills[c]!.push(`M${x} ${y}h${cw}v${ch}h${-cw}Z`);
      // A cell border wherever land meets sea, like a range given an outline.
      if (!isLand(i + 1, j)) borders.push(`M${x + cw - 0.5} ${y - 0.5}v${ch}`);
      if (!isLand(i - 1, j)) borders.push(`M${x - 0.5} ${y - 0.5}v${ch}`);
      if (!isLand(i, j + 1)) borders.push(`M${x - 0.5} ${y + ch - 0.5}h${cw}`);
      if (!isLand(i, j - 1)) borders.push(`M${x - 0.5} ${y - 0.5}h${cw}`);
    }

  if (globe) {
    // The plot area: the sea as pale blue cells, the grid over it.
    ctx.save();
    ctx.clip(disc);
    ctx.fillStyle = "#e7f0fa";
    ctx.fillRect(gx - R, gy - R, R * 2, R * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#cfdcea";
    ctx.stroke(gridPath);
    ctx.restore();
  }
  const colours = [...SCALE, SAND, ICE];
  fills.forEach((list, c) => {
    if (!list.length) return;
    ctx.fillStyle = colours[c]!;
    ctx.fill(new Path2D(list.join("")));
  });
  // Filled cells hide the gridlines; a faint white line keeps each cell readable.
  ctx.save();
  ctx.clip(new Path2D(fills.flat().join("")));
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1;
  ctx.stroke(gridPath);
  ctx.restore();
  ctx.lineWidth = t.coastWidth;
  ctx.strokeStyle = t.coast;
  ctx.lineCap = "square";
  ctx.stroke(new Path2D(borders.join("")));
  ctx.lineCap = "butt";

  if (globe) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#8b9199";
    ctx.stroke(disc);
    drawChart(f, cache, gx, gy, R, true);
  }
}

/** Whether a point is on the globe's near side. */
function facing(f: SurfaceFrame, lon: number, lat: number): boolean {
  const r = Math.PI / 180;
  const a = lat * r, b = f.lat * r;
  return Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((lon - f.lon) * r) > 0.02;
}

/**
 * The globe as a chart object on the sheet: a white box with a soft shadow that hides the gridlines (`handles`
 * false, drawn under the globe), then its thin frame and eight square selection handles (drawn over it).
 */
function drawChart(f: SurfaceFrame, cache: SheetCache, cx: number, cy: number, R: number, handles: boolean) {
  const { ctx, w, h, dpr } = f;
  const pad = Math.max(18, R * 0.16);
  const x = Math.round(cx - R - pad) + 0.5, y = Math.round(cy - R - pad) + 0.5;
  const s = Math.round(2 * (R + pad));
  if (!handles) {
    ctx.save();
    ctx.shadowColor = "rgba(60,64,67,0.28)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, y, s, s);
    ctx.restore();
    return;
  }
  const key = `${w}:${h}:${dpr}:${x}:${y}:${s}`;
  if (cache.chart?.key !== key) {
    const [canvas, g] = offscreen(w, h, dpr);
    g.lineWidth = 1;
    g.strokeStyle = "#9aa0a6";
    g.strokeRect(x, y, s, s);
    // A second frame just inside, as a selected object shows.
    g.strokeStyle = "rgba(45,134,83,0.55)";
    g.strokeRect(x + 3, y + 3, s - 6, s - 6);
    const hs = 7;
    g.fillStyle = "#ffffff";
    g.strokeStyle = "#5f6368";
    for (const [hx, hy] of [
      [x, y],
      [x + s / 2, y],
      [x + s, y],
      [x, y + s / 2],
      [x + s, y + s / 2],
      [x, y + s],
      [x + s / 2, y + s],
      [x + s, y + s],
    ] as const) {
      g.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      g.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
    }
    cache.chart = { key, canvas };
  }
  ctx.drawImage(cache.chart.canvas, 0, 0, w, h);
}
