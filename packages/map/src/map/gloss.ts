// Console Menu (id cube): the clean, glossy look of an early-2000s console's home menu. In Map view the map sits in
// one rounded "channel" tile with a white plastic rim; in Globe view it is a glossy ball. Land stands up like soft
// white plastic: a drop shadow and a side under a lit top, a highlight along the upper edges and a shade along the
// lower ones, and mountains as soft rounded bumps. The sea is pale blue glass with light along the coasts, and a
// sheen lies over the top of the tile or the ball. Outside the tile the page's slow wavy lines show through (CSS on
// .map). No maker's names, logos or menus, and no text.

import { geoGraticule, geoPath } from "d3-geo";
import { cachedPicture, offscreen, pathContext, Picture, type SurfaceFrame, type SurfaceResult } from "./surface.ts";

const GRID = geoGraticule().step([15, 15])();
const SPHERE = { type: "Sphere" } as const;

/** What the menu keeps between frames: the tile's rim and shadow, the bump drawn at each peak, the picture. */
export class GlossCache {
  frame?: { key: string; canvas: HTMLCanvasElement; tile: Path2D; inset: number };
  bump?: HTMLCanvasElement;
  picture = new Picture();
}

/** The channel tile: the frame inset a little, with round corners. */
function tileGeometry(w: number, h: number): { inset: number; radius: number } {
  const inset = Math.min(w, h) < 420 ? 8 : 16;
  const radius = Math.max(12, Math.min(26, Math.min(w, h) * 0.05));
  return { inset, radius };
}

/** The tile's soft shadow on the page and its white plastic rim, drawn once per size. Outside it stays clear. */
function tileFrame(w: number, h: number, dpr: number, tile: Path2D): HTMLCanvasElement {
  const [c, g] = offscreen(w, h, dpr);
  g.save();
  g.shadowColor = "rgba(40,80,120,0.28)";
  g.shadowBlur = 16;
  g.shadowOffsetY = 5;
  g.fillStyle = "#ffffff";
  g.fill(tile);
  g.restore();
  g.lineWidth = 7;
  g.strokeStyle = "#ffffff";
  g.stroke(tile);
  g.lineWidth = 1;
  g.strokeStyle = "rgba(120,140,160,0.55)";
  g.stroke(tile);
  return c;
}

/** A soft rounded hill: shade to the lower right, light to the upper left. Drawn once, stamped at every peak. */
function bumpSprite(shade: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const g = c.getContext("2d")!;
  const dark = g.createRadialGradient(28, 29, 0, 28, 29, 20);
  dark.addColorStop(0, shade);
  dark.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = dark;
  g.fillRect(0, 0, 48, 48);
  const light = g.createRadialGradient(20, 19, 0, 20, 19, 15);
  light.addColorStop(0, "rgba(255,255,255,0.95)");
  light.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = light;
  g.fillRect(0, 0, 48, 48);
  return c;
}

export function drawGloss(f: SurfaceFrame, cache: GlossCache): SurfaceResult | void {
  const { ctx, w, h, dpr, proj, mode, theme: t } = f;
  const globe = mode === "3d";
  const R = proj.scale();
  const [cx, cy] = proj.translate();

  let tile: Path2D | null = null;
  let inset = 0;
  if (!globe) {
    const key = `${w}:${h}:${dpr}`;
    if (cache.frame?.key !== key) {
      const geo = tileGeometry(w, h);
      const p = new Path2D();
      p.roundRect(geo.inset, geo.inset, w - geo.inset * 2, h - geo.inset * 2, geo.radius);
      cache.frame = { key, canvas: tileFrame(w, h, dpr, p), tile: p, inset: geo.inset };
    }
    tile = cache.frame.tile;
    inset = cache.frame.inset;
    ctx.drawImage(cache.frame.canvas, 0, 0, w, h);
  }
  cache.bump ??= bumpSprite(t.relief);
  const bump = cache.bump;

  const pk = `${w}:${h}:${dpr}:${mode}:${f.lon.toFixed(5)}:${f.lat.toFixed(5)}:${f.zoom.toFixed(5)}:${f.map === f.low ? "l" : "h"}:${f.relief ? 1 : 0}`;
  cachedPicture(cache.picture, f, pk, (g) => {
    const path = (o: object) => {
      const p = new Path2D();
      geoPath(f.view as never, pathContext(p))(o as never);
      return p;
    };
    const sphere = path(SPHERE);
    if (globe) {
      // The ball's soft shadow on the page below it.
      const sy = cy + R * 1.06;
      const sh = g.createRadialGradient(cx, sy, 0, cx, sy, R * 0.85);
      sh.addColorStop(0, "rgba(40,80,120,0.26)");
      sh.addColorStop(1, "rgba(40,80,120,0)");
      g.save();
      g.translate(cx, sy);
      g.scale(1, 0.14);
      g.translate(-cx, -sy);
      g.fillStyle = sh;
      g.fillRect(cx - R, sy - R, R * 2, R * 2);
      g.restore();
    }
    const area = tile ?? sphere;
    g.save();
    g.clip(area);

    // Pale blue glass: lighter toward the top of the tile, or toward the lit side of the ball.
    let sea: CanvasGradient;
    if (globe) {
      sea = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R * 1.02);
      sea.addColorStop(0, "#d9f3fc");
      sea.addColorStop(0.55, t.lake);
      sea.addColorStop(1, t.ocean);
    } else {
      sea = g.createLinearGradient(0, inset, 0, h - inset);
      sea.addColorStop(0, "#d4f1fc");
      sea.addColorStop(1, t.ocean);
    }
    g.fillStyle = sea;
    g.fillRect(0, 0, w, h);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = t.graticule;
    g.lineWidth = 0.8;
    g.stroke(path(GRID));

    const land = path(f.map.land);
    const coast = path(f.map.coast);
    // Light along the coasts, like shallow water.
    g.strokeStyle = t.waterline;
    g.lineWidth = 7;
    g.stroke(coast);
    g.lineWidth = 3.5;
    g.stroke(coast);

    // The land as a slab of soft plastic: a shadow on the water, a darker side, then the lit top.
    const depth = Math.max(2, Math.min(4.5, 1.6 + f.zoom * 0.35));
    const at = (dx: number, dy: number, fill: () => void) => {
      g.translate(dx, dy);
      fill();
      g.translate(-dx, -dy);
    };
    g.fillStyle = "rgba(30,80,120,0.12)";
    at(1, depth + 3, () => g.fill(land));
    g.fillStyle = "rgba(30,80,120,0.12)";
    at(0.5, depth + 1.5, () => g.fill(land));
    g.fillStyle = t.textureInk;
    at(0, depth, () => g.fill(land));
    const top = globe ? g.createLinearGradient(0, cy - R, 0, cy + R) : g.createLinearGradient(0, inset, 0, h - inset);
    top.addColorStop(0, "#ffffff");
    top.addColorStop(1, t.land);
    g.fillStyle = top;
    g.fill(land);
    if (f.map.ice) {
      g.fillStyle = t.ice;
      g.fill(path(f.map.ice));
    }

    // Round the top's edges: light along the upper ones, shade along the lower ones, inside the land only.
    g.save();
    g.clip(land);
    g.strokeStyle = "rgba(255,255,255,0.95)";
    g.lineWidth = 2.4;
    at(0, 1.4, () => g.stroke(coast));
    g.strokeStyle = "rgba(70,100,125,0.22)";
    g.lineWidth = 3;
    at(0, -1.6, () => g.stroke(coast));

    // Mountains as soft bumps that grow with the map and overlap into rounded ridges.
    if (f.relief) {
      const s = Math.max(3.5, Math.min(20, R * 0.035));
      const peaks = f.relief.peaks;
      const [ux, uy, uz] = unit(f.lon, f.lat);
      for (let i = 0; i < peaks.length; i++) {
        const [lon, lat] = peaks[i]!;
        if (globe) {
          const [px, py, pz] = unit(lon, lat);
          if (px * ux + py * uy + pz * uz < 0.08) continue;
        }
        const p = proj([lon, lat]);
        if (!p) continue;
        if (p[0] < -s || p[1] < -s || p[0] > w + s || p[1] > h + s) continue;
        g.drawImage(bump, p[0] - s, p[1] - s, s * 2, s * 2);
      }
    }
    g.restore();

    // Lakes and rivers in the sea's pale blue.
    g.fillStyle = t.lake;
    g.fill(path(f.map.lakes));
    if (f.zoom >= 2) {
      g.strokeStyle = t.river;
      g.lineWidth = 0.9;
      g.stroke(path(f.map.rivers));
    }
    g.lineWidth = 0.8;
    g.strokeStyle = t.coast;
    g.stroke(coast);

    // The sheen: glossy light over the top of the tile, or a highlight on the ball with its rim in shade.
    if (globe) {
      const rim = g.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
      rim.addColorStop(0, "rgba(20,80,140,0)");
      rim.addColorStop(1, "rgba(20,80,140,0.3)");
      g.fillStyle = rim;
      g.fillRect(cx - R, cy - R, R * 2, R * 2);
      const hx = cx - R * 0.34, hy = cy - R * 0.5;
      g.save();
      g.translate(hx, hy);
      g.rotate(-0.45);
      g.scale(1, 0.52);
      const spec = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.5);
      spec.addColorStop(0, "rgba(255,255,255,0.55)");
      spec.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = spec;
      g.fillRect(-R * 0.5, -R * 0.5, R, R);
      g.restore();
    } else {
      const y1 = inset + (h - inset * 2) * 0.34;
      const sheen = new Path2D();
      sheen.moveTo(0, 0);
      sheen.lineTo(w, 0);
      sheen.lineTo(w, y1 - (h - inset * 2) * 0.08);
      sheen.quadraticCurveTo(w / 2, y1 + (h - inset * 2) * 0.1, 0, y1 - (h - inset * 2) * 0.08);
      sheen.closePath();
      const sg = g.createLinearGradient(0, inset, 0, y1);
      sg.addColorStop(0, "rgba(255,255,255,0.42)");
      sg.addColorStop(1, "rgba(255,255,255,0.08)");
      g.fillStyle = sg;
      g.fill(sheen);
    }
    g.restore();

    // A white glass rim round the ball.
    if (globe) {
      g.lineWidth = 3;
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.stroke(sphere);
      g.lineWidth = 1;
      g.strokeStyle = "rgba(90,130,165,0.6)";
      g.stroke(sphere);
    }
  });

  if (!tile) return;
  const m = inset + 4;
  return { inside: (x, y) => x > m && y > m && x < w - m && y < h - m, clip: tile };
}

/** A point on the unit sphere, for keeping the globe's far side clear of bumps. */
function unit(lon: number, lat: number): [number, number, number] {
  const a = (lon * Math.PI) / 180, b = (lat * Math.PI) / 180;
  return [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)];
}
