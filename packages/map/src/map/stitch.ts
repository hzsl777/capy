// Cross Stitch (decision 70): the world embroidered on linen aida cloth. The frame is a grid of cells fixed to the
// screen, like the pixel designs; each land cell is an X of two crossed stitches in a thread chosen by climate and
// relief, coasts are backstitched along the cells' edges, and the sea is bare cloth with a row of pale blue half
// stitches along the shore. In Globe view the cloth is held in a wooden embroidery hoop, which is the globe's outline.

import { geoPath } from "d3-geo";
import { offscreen, type SurfaceFrame } from "./surface.ts";

/** Threads, as [under stitch, over stitch, sheen]. */
type Thread = [string, string, string];

function thread(hex: string): Thread {
  const v = parseInt(hex.slice(1), 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  const mix = (k: number, to: number) => `rgb(${Math.round(r + (to - r) * k)},${Math.round(g + (to - g) * k)},${Math.round(b + (to - b) * k)})`;
  return [mix(0.28, 0), hex, mix(0.45, 255)];
}

// Two tones of each thread, so a field of one colour still reads as separate stitches.
const THREADS: Thread[][] = [
  ["#9aa37a", "#8e9a70"], // tundra
  ["#3f6f4a", "#476f3c"], // boreal forest
  ["#6e9f45", "#7aa84c"], // temperate
  ["#2f8a5a", "#3a9460"], // tropics
  ["#d6a553", "#cf9a48"], // sand
  ["#8a5a3c", "#7c5034"], // mountains
  ["#f7f5ee", "#ecebe4"], // ice
].map((pair) => pair.map(thread));
const TUNDRA = 0, BOREAL = 1, TEMPERATE = 2, TROPIC = 3, SAND = 4, MOUNTAIN = 5, ICE = 6;

export class StitchCache {
  cloth?: { key: string; pattern: CanvasPattern };
  small?: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
  hoop?: { key: string; canvas: HTMLCanvasElement };
}

/** Cell size in CSS pixels: the cloth's count. */
const cellFor = (w: number) => (w < 560 ? 7 : 9);

/** One cell of aida cloth: a hole at each corner, the weave as faint raised blocks between them. */
function cloth(f: SurfaceFrame, c: number, cache: StitchCache): CanvasPattern {
  const key = `${c}:${f.dpr}:${f.theme.ocean}`;
  if (cache.cloth?.key === key) return cache.cloth.pattern;
  const [tile, g] = offscreen(c, c, f.dpr);
  g.fillStyle = f.theme.ocean;
  g.fillRect(0, 0, c, c);
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.fillRect(1.2, 1.2, c - 2.4, c - 2.4);
  g.fillStyle = "rgba(120,96,60,0.10)";
  g.fillRect(c * 0.5 - 0.4, 1, 0.8, c - 2);
  g.fillRect(1, c * 0.5 - 0.4, c - 2, 0.8);
  g.fillStyle = f.theme.textureInk;
  g.fillRect(0, 0, 1.3, 1.3);
  const pattern = f.ctx.createPattern(tile, "repeat")!;
  pattern.setTransform(new DOMMatrix().scale(1 / f.dpr));
  cache.cloth = { key, pattern };
  return pattern;
}

export function drawStitch(f: SurfaceFrame, cache: StitchCache) {
  const { ctx, w, h, proj, theme: t, mode } = f;
  const c = cellFor(w);
  const cols = Math.ceil(w / c), rows = Math.ceil(h / c);
  const globe = mode === "3d";
  const [gx, gy] = proj.translate();
  const R = proj.scale();

  // The cloth: everywhere on the flat map, inside the hoop on the globe.
  const hoopIn = new Path2D();
  hoopIn.arc(gx, gy, R, 0, Math.PI * 2);
  ctx.fillStyle = cloth(f, c, cache);
  if (globe) ctx.fill(hoopIn);
  else ctx.fillRect(0, 0, w, h);

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
  sg.setTransform(1 / c, 0, 0, 1 / c, 0, 0);
  const small = geoPath(proj, sg);
  // Cells are coarse, so the light basemap is enough until zoomed far in.
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
      sg.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
    }
  };
  dab(f.relief?.dunes, "#ffff00", c * 1.1);
  dab(f.relief?.peaks, "#ff0000", c * 0.55);
  if (base.ice) {
    sg.beginPath();
    small(base.ice);
    sg.fillStyle = "#0000ff";
    sg.fill();
  }
  sg.globalCompositeOperation = "source-over";
  sg.setTransform(1, 0, 0, 1, 0, 0);
  const px = sg.getImageData(0, 0, cols, rows).data;

  const kind = new Int8Array(cols * rows).fill(-1);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const o = (j * cols + i) * 4;
      if (px[o + 3]! < 110) continue;
      const r = px[o]!, g = px[o + 1]!, b = px[o + 2]!;
      let k: number;
      if (b > 120) k = ICE;
      else if (r > 120 && g > 120) k = SAND;
      else if (r > 120) k = MOUNTAIN;
      else {
        const ll = proj.invert?.([(i + 0.5) * c, (j + 0.5) * c]);
        const lat = ll ? Math.abs(ll[1]) : 30;
        // Band edges wander a few degrees, so climates don't meet along ruled lines.
        const jitter = ll ? (wobble(Math.round(ll[0] / 3), Math.round(ll[1] / 3)) - 0.5) * 6 : 0;
        const l = lat + jitter;
        k = l > 62 ? TUNDRA : l > 50 ? BOREAL : l < 17 ? TROPIC : TEMPERATE;
      }
      kind[j * cols + i] = k;
    }

  // Stitches as SVG path text, one path per thread and layer: thousands of strokes in a few calls.
  const under = THREADS.map(() => [[], []] as string[][]);
  const over = THREADS.map(() => [[], []] as string[][]);
  const sheen = THREADS.map(() => [[], []] as string[][]);
  const back: string[] = [];
  const shore: string[] = [];
  const m = c * 0.17;
  const e = c - m;
  const inHoop = (i: number, j: number) => !globe || Math.hypot((i + 0.5) * c - gx, (j + 0.5) * c - gy) < R - c * 0.7;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = kind[j * cols + i]!;
      const x = i * c, y = j * c;
      if (k < 0) {
        // Sea next to land: a pale blue half stitch.
        if (!inHoop(i, j)) continue;
        let near = false;
        for (let dj = -1; dj <= 1 && !near; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii >= 0 && jj >= 0 && ii < cols && jj < rows && kind[jj * cols + ii]! >= 0) {
              near = true;
              break;
            }
          }
        if (near) shore.push(`M${x + m} ${y + e}L${x + e} ${y + m}`);
        continue;
      }
      const tone = (i * 7 + j * 13 + ((i * j) % 5)) % 3 === 0 ? 1 : 0;
      under[k]![tone]!.push(`M${x + m} ${y + e}L${x + e} ${y + m}`);
      over[k]![tone]!.push(`M${x + m} ${y + m}L${x + e} ${y + e}`);
      sheen[k]![tone]!.push(`M${x + m + c * 0.12} ${y + m}L${x + c * 0.5} ${y + c * 0.5 - c * 0.12}`);
      // Backstitch where land meets sea: along the cell's right and bottom edges, and left and top at the frame.
      const land = (ii: number, jj: number) => ii >= 0 && jj >= 0 && ii < cols && jj < rows && kind[jj * cols + ii]! >= 0;
      const g = 0.7;
      if (!land(i + 1, j)) back.push(`M${x + c} ${y + g}L${x + c} ${y + c - g}`);
      if (!land(i - 1, j)) back.push(`M${x} ${y + g}L${x} ${y + c - g}`);
      if (!land(i, j + 1)) back.push(`M${x + g} ${y + c}L${x + c - g} ${y + c}`);
      if (!land(i, j - 1)) back.push(`M${x + g} ${y}L${x + c - g} ${y}`);
    }

  ctx.save();
  if (globe) ctx.clip(hoopIn);
  ctx.lineCap = "round";
  ctx.lineWidth = c * 0.2;
  ctx.strokeStyle = t.waterline;
  ctx.stroke(new Path2D(shore.join("")));
  const stroke = (lists: string[][][], layer: 0 | 1 | 2, width: number) => {
    ctx.lineWidth = width;
    lists.forEach((tones, k) =>
      tones.forEach((list, tone) => {
        if (!list.length) return;
        ctx.strokeStyle = THREADS[k]![tone]![layer];
        ctx.stroke(new Path2D(list.join("")));
      }),
    );
  };
  stroke(under, 0, c * 0.34);
  stroke(over, 1, c * 0.34);
  stroke(sheen, 2, c * 0.1);
  ctx.lineWidth = t.coastWidth;
  ctx.strokeStyle = t.coast;
  ctx.stroke(new Path2D(back.join("")));
  ctx.restore();

  if (globe) drawHoop(f, cache, gx, gy, R);
}

/** Whether a point is on the globe's near side. */
function facing(f: SurfaceFrame, lon: number, lat: number): boolean {
  const r = Math.PI / 180;
  const a = lat * r, b = f.lat * r;
  return Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((lon - f.lon) * r) > 0.02;
}

function wobble(a: number, b: number): number {
  const s = Math.sin(a * 91.7 + b * 47.3) * 24634.6345;
  return s - Math.floor(s);
}

/** A wooden embroidery hoop around the globe, with its brass screw at the top. */
function drawHoop(f: SurfaceFrame, cache: StitchCache, cx: number, cy: number, R: number) {
  const { ctx, w, h, dpr } = f;
  const key = `${w}:${h}:${dpr}:${Math.round(cx)}:${Math.round(cy)}:${Math.round(R)}`;
  if (cache.hoop?.key !== key) {
    const [canvas, g] = offscreen(w, h, dpr);
    const band = Math.max(8, R * 0.055);
    // The cloth dips into the hoop: a soft shadow inside the rim.
    const dip = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R);
    dip.addColorStop(0, "rgba(80,56,30,0)");
    dip.addColorStop(1, "rgba(80,56,30,0.28)");
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fillStyle = dip;
    g.fill();
    // Its shadow on the page.
    g.save();
    g.shadowColor = "rgba(60,40,20,0.35)";
    g.shadowBlur = 14;
    g.shadowOffsetY = 5;
    g.beginPath();
    g.arc(cx, cy, R + band / 2, 0, Math.PI * 2);
    g.lineWidth = band;
    g.strokeStyle = "#b98646";
    g.stroke();
    g.restore();
    const wood = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    wood.addColorStop(0, "#e2b173");
    wood.addColorStop(0.5, "#c28c4c");
    wood.addColorStop(1, "#9a6630");
    g.beginPath();
    g.arc(cx, cy, R + band / 2, 0, Math.PI * 2);
    g.lineWidth = band;
    g.strokeStyle = wood;
    g.stroke();
    // Grain: thin arcs along the ring.
    g.lineWidth = 0.7;
    g.strokeStyle = "rgba(110,66,26,0.35)";
    for (let i = 0; i < 9; i++) {
      const rr = R + band * (0.2 + (i % 4) * 0.2);
      const a0 = i * 0.71, a1 = a0 + 0.6 + (i % 3) * 0.35;
      g.beginPath();
      g.arc(cx, cy, rr, a0, a1);
      g.stroke();
    }
    g.lineWidth = 1;
    g.strokeStyle = "rgba(70,40,14,0.55)";
    g.beginPath();
    g.arc(cx, cy, R + 0.5, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, R + band, 0, Math.PI * 2);
    g.stroke();
    // The clasp: two wooden lugs and a brass screw through them.
    const top = cy - R - band;
    const lw = band * 0.9;
    for (const dx of [-band * 0.75, band * 0.75]) {
      const x = cx + dx - lw / 2;
      const lug = g.createLinearGradient(x, 0, x + lw, 0);
      lug.addColorStop(0, "#d9a766");
      lug.addColorStop(1, "#9a6630");
      g.fillStyle = lug;
      g.strokeStyle = "rgba(70,40,14,0.6)";
      g.beginPath();
      g.roundRect(x, top - band * 1.6, lw, band * 1.9, 2);
      g.fill();
      g.stroke();
    }
    const sy = top - band * 0.8;
    const brass = g.createLinearGradient(0, sy - band * 0.3, 0, sy + band * 0.3);
    brass.addColorStop(0, "#fbe7a1");
    brass.addColorStop(0.5, "#c9a03e");
    brass.addColorStop(1, "#7a5a18");
    g.fillStyle = brass;
    g.beginPath();
    g.roundRect(cx - band * 2, sy - band * 0.22, band * 4, band * 0.44, band * 0.2);
    g.fill();
    g.beginPath();
    g.arc(cx + band * 2.1, sy, band * 0.42, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(90,60,10,0.8)";
    g.lineWidth = 1;
    g.stroke();
    g.beginPath();
    g.moveTo(cx + band * 2.1, sy - band * 0.3);
    g.lineTo(cx + band * 2.1, sy + band * 0.3);
    g.stroke();
    cache.hoop = { key, canvas };
  }
  ctx.drawImage(cache.hoop.canvas, 0, 0, w, h);
}
