// Couch Potato (id cube): inside the map, an old console news channel's Earth (decision 104). In Globe view the
// planet hangs in dark blue space with a glow of air round it; in Map view the same Earth fills one rounded channel
// tile with a white plastic rim. The sea is deep blue with lighter shallows, the land green, darker in the tropics and
// the northern forests and dun toward the poles, with tan deserts, soft brown mountains and white ice. The stars
// behind are CSS on .map. No maker's names, logos or menus, and no text.

import { geoGraticule, geoPath } from "d3-geo";
import { cachedPicture, offscreen, pathContext, Picture, type SurfaceFrame, type SurfaceResult } from "./surface.ts";

const GRID = geoGraticule().step([15, 15])();
const SPHERE = { type: "Sphere" } as const;

/** What the menu keeps between frames: the tile's rim and shadow, the bump drawn at each peak, the picture. */
export class GlossCache {
  frame?: { key: string; canvas: HTMLCanvasElement; tile: Path2D; inset: number };
  bump?: HTMLCanvasElement;
  sand?: HTMLCanvasElement;
  bands?: (readonly [object, string])[];
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

/** Latitude bands laid over the land as tints: south edge, north edge, colour. */
const BANDS: [number, number, string, number][] = [
  [-10, 10, "22,92,34", 0.4],
  [50, 60, "28,66,38", 0.38],
  [66, 90, "150,140,104", 0.6],
  [-90, -54, "150,140,104", 0.6],
];

/** A soft round patch of colour that fades out, stamped many times to paint the deserts. */
function blob(color: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(24, 24, 0, 24, 24, 24);
  r.addColorStop(0, color);
  r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 48, 48);
  return c;
}

/** A soft rounded hill: shade to the lower right, light to the upper left. Drawn once, stamped at every peak. */
function bumpSprite(shade: string, top: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const g = c.getContext("2d")!;
  const dark = g.createRadialGradient(28, 29, 0, 28, 29, 20);
  dark.addColorStop(0, shade);
  dark.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = dark;
  g.fillRect(0, 0, 48, 48);
  const light = g.createRadialGradient(20, 19, 0, 20, 19, 15);
  light.addColorStop(0, top);
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
  cache.bump ??= bumpSprite(t.relief, "rgba(236,226,204,0.55)");
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
      // The air round the planet, a blue glow against the dark of space (decision 104).
      const halo = g.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.14);
      halo.addColorStop(0, "rgba(150,205,255,0.6)");
      halo.addColorStop(0.35, "rgba(90,160,240,0.22)");
      halo.addColorStop(1, "rgba(60,120,220,0)");
      g.fillStyle = halo;
      g.beginPath();
      g.arc(cx, cy, R * 1.14, 0, Math.PI * 2);
      g.fill();
    }
    const area = tile ?? sphere;
    g.save();
    g.clip(area);

    // Deep blue sea, lighter toward the lit side of the planet or the top of the tile.
    let sea: CanvasGradient;
    if (globe) {
      sea = g.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R * 1.02);
      sea.addColorStop(0, t.lake);
      sea.addColorStop(0.6, t.ocean);
      sea.addColorStop(1, "#0d3a78");
    } else {
      sea = g.createLinearGradient(0, inset, 0, h - inset);
      sea.addColorStop(0, t.lake);
      sea.addColorStop(1, t.ocean);
    }
    g.fillStyle = sea;
    g.fillRect(0, 0, w, h);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = t.graticule;
    g.lineWidth = 0.7;
    g.stroke(path(GRID));

    const land = path(f.map.land);
    const coast = path(f.map.coast);
    // Shallow water along the coasts, lighter as it nears the shore.
    g.strokeStyle = t.waterline;
    g.lineWidth = 8;
    g.stroke(coast);
    g.lineWidth = 4;
    g.stroke(coast);

    // The land as seen from space: green, darker in the tropics and the northern forests, dun toward the poles,
    // tan over the deserts and white over the ice. Bands follow latitude only, never any political unit.
    const lit = globe ? g.createLinearGradient(0, cy - R, 0, cy + R) : g.createLinearGradient(0, inset, 0, h - inset);
    lit.addColorStop(0, "#74a957");
    lit.addColorStop(1, t.land);
    g.fillStyle = lit;
    g.fill(land);
    g.save();
    g.clip(land);
    // Each band is laid as a few widening layers, so its edges fade over ten degrees instead of meeting along a line.
    cache.bands ??= BANDS.flatMap(([s0, n0, rgb, a]) =>
      [0, 1, 2, 3, 4].map(
        (i) => [geoGraticule().extent([[-180, Math.max(-90, s0 - i * 2.5)], [180, Math.min(90, n0 + i * 2.5)]]).outline(), `rgba(${rgb},${(a / 5).toFixed(3)})`] as const,
      ),
    );
    for (const [band, fill] of cache.bands) {
      g.fillStyle = fill;
      g.fill(path(band));
    }
    const s = Math.max(3, Math.min(16, R * 0.024));
    const [ux, uy, uz] = unit(f.lon, f.lat);
    const stamp = (pts: [number, number][] | undefined, sprite: HTMLCanvasElement, size: number) => {
      if (!pts) return;
      for (const [lon, lat] of pts) {
        if (globe) {
          const [px, py, pz] = unit(lon, lat);
          if (px * ux + py * uy + pz * uz < 0.08) continue;
        }
        const p = proj([lon, lat]);
        if (!p || p[0] < -size || p[1] < -size || p[0] > w + size || p[1] > h + size) continue;
        g.drawImage(sprite, p[0] - size, p[1] - size, size * 2, size * 2);
      }
    };
    cache.sand ??= blob("rgba(222,192,128,0.7)");
    stamp(f.relief?.dunes, cache.sand, s * 2);
    // Mountains as soft bumps, brown with a light top.
    stamp(f.relief?.peaks, bump, s);
    g.restore();
    if (f.map.ice) {
      g.fillStyle = t.ice;
      g.fill(path(f.map.ice));
    }

    g.fillStyle = t.lake;
    g.fill(path(f.map.lakes));
    if (f.zoom >= 2) {
      g.strokeStyle = t.river;
      g.lineWidth = 0.9;
      g.stroke(path(f.map.rivers));
    }
    g.lineWidth = 0.7;
    g.strokeStyle = t.coast;
    g.stroke(coast);

    // The planet's edge falls into shade with a soft highlight on its lit side; the tile gets its glossy sheen.
    if (globe) {
      const rim = g.createRadialGradient(cx - R * 0.15, cy - R * 0.15, R * 0.6, cx, cy, R);
      rim.addColorStop(0, "rgba(4,16,40,0)");
      rim.addColorStop(1, "rgba(4,16,40,0.5)");
      g.fillStyle = rim;
      g.fillRect(cx - R, cy - R, R * 2, R * 2);
      const hx = cx - R * 0.34, hy = cy - R * 0.5;
      g.save();
      g.translate(hx, hy);
      g.rotate(-0.45);
      g.scale(1, 0.52);
      const spec = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.5);
      spec.addColorStop(0, "rgba(255,255,255,0.3)");
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
      sg.addColorStop(0, "rgba(255,255,255,0.22)");
      sg.addColorStop(1, "rgba(255,255,255,0.04)");
      g.fillStyle = sg;
      g.fill(sheen);
    }
    g.restore();

    // A thin bright limb, where the air catches the light.
    if (globe) {
      g.lineWidth = 1.5;
      g.strokeStyle = "rgba(190,225,255,0.85)";
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
