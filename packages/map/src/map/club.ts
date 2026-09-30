// Country Club (decision 74): preppy heritage clothing. The flat map is embroidered on oxford cloth: a pale blue
// basket weave for the sea, land as a raised hunter green patch in satin stitch with a dark satin edge and a cream
// running stitch along it, small chevron stitches on the mountains. The globe is a leather desk globe: navy leather
// sea, green leather land tooled with a gold line along every coast, on a brass half meridian and a turned stand.
// Nothing is drawn in open ocean, and there is no text, crest or flag on the canvas.

import { geoGraticule, geoPath } from "d3-geo";
import { offscreen, pathContext, seeded, type SurfaceFrame } from "./surface.ts";

const TOOLING = geoGraticule().step([30, 30])();

export class ClubCache {
  patterns = new Map<string, CanvasPattern>();
  stand?: { key: string; back: HTMLCanvasElement; front: HTMLCanvasElement };
}

function tile(f: SurfaceFrame, cache: ClubCache, key: string, size: number, draw: (g: CanvasRenderingContext2D) => void): CanvasPattern {
  const k = `${key}:${f.dpr}`;
  let p = cache.patterns.get(k);
  if (p) return p;
  const [c, g] = offscreen(size, size, f.dpr);
  draw(g);
  p = f.ctx.createPattern(c, "repeat")!;
  p.setTransform(new DOMMatrix().scale(1 / f.dpr));
  cache.patterns.set(k, p);
  return p;
}

/** Oxford cloth: white warp over blue weft in pairs, a basket weave. */
function oxford(f: SurfaceFrame, cache: ClubCache): CanvasPattern {
  return tile(f, cache, "oxford", 6, (g) => {
    g.fillStyle = f.theme.ocean;
    g.fillRect(0, 0, 6, 6);
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.fillRect(0, 0.3, 3, 1);
    g.fillRect(0, 1.6, 3, 1);
    g.fillRect(3, 3.3, 3, 1);
    g.fillRect(3, 4.6, 3, 1);
    g.fillStyle = "rgba(60,86,130,0.16)";
    g.fillRect(3.3, 0, 1, 3);
    g.fillRect(4.6, 0, 1, 3);
    g.fillRect(0.3, 3, 1, 3);
    g.fillRect(1.6, 3, 1, 3);
  });
}

/** Satin stitch: long parallel diagonal stitches, each with a sheen and a shadow. */
function satin(f: SurfaceFrame, cache: ClubCache): CanvasPattern {
  return tile(f, cache, "satin", 8, (g) => {
    g.lineCap = "butt";
    for (const off of [-8, 0, 8]) {
      g.strokeStyle = f.theme.textureInk2 ?? "rgba(0,0,0,0.15)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(off + 0, 8);
      g.lineTo(off + 8, 0);
      g.stroke();
      g.strokeStyle = f.theme.textureInk;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(off + 2.2, 8);
      g.lineTo(off + 8 + 2.2, 0);
      g.stroke();
    }
  });
}

/** Leather: soft grain, lighter and darker specks, drawn once. */
function grain(f: SurfaceFrame, cache: ClubCache): CanvasPattern {
  return tile(f, cache, "grain", 64, (g) => {
    const rnd = seeded(17);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = i % 2 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.1)";
      g.beginPath();
      g.ellipse(rnd() * 64, rnd() * 64, 0.6 + rnd() * 1.6, 0.4 + rnd() * 1, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
}

export function drawClub(f: SurfaceFrame, cache: ClubCache) {
  if (f.mode === "3d") drawDeskGlobe(f, cache);
  else drawEmbroidery(f, cache);
}

function drawEmbroidery(f: SurfaceFrame, cache: ClubCache) {
  const { ctx, w, h, proj, theme: t } = f;
  ctx.fillStyle = oxford(f, cache);
  ctx.fillRect(0, 0, w, h);

  const land = new Path2D();
  geoPath(proj, pathContext(land))(f.map.land);
  const coast = new Path2D();
  geoPath(proj, pathContext(coast))(f.map.coast);

  // The patch stands off the cloth: a soft shadow below and to the right.
  ctx.save();
  ctx.translate(1.2, 2);
  ctx.fillStyle = "rgba(30,40,60,0.22)";
  ctx.fill(land);
  ctx.restore();
  ctx.fillStyle = t.land;
  ctx.fill(land);
  ctx.fillStyle = satin(f, cache);
  ctx.fill(land);
  if (f.map.ice) {
    const ice = new Path2D();
    geoPath(proj, pathContext(ice))(f.map.ice);
    ctx.fillStyle = t.ice;
    ctx.fill(ice);
    ctx.fillStyle = satin(f, cache);
    ctx.fill(ice);
  }

  // Chevron stitches on the mountains, in a lighter thread.
  const peaks = f.relief?.peaks;
  if (peaks) {
    const s = Math.min(5, Math.max(2.2, proj.scale() * 0.008));
    const out: string[] = [];
    for (const [lon, lat] of peaks) {
      const p = proj([lon, lat]);
      if (!p || p[0] < -8 || p[1] < -8 || p[0] > w + 8 || p[1] > h + 8) continue;
      out.push(`M${(p[0] - s).toFixed(1)} ${(p[1] + s * 0.5).toFixed(1)}l${s} ${-s}l${s} ${s}`);
    }
    ctx.save();
    ctx.clip(land);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = t.relief;
    ctx.stroke(new Path2D(out.join("")));
    ctx.restore();
  }

  // Rivers in a pale blue running stitch, more of them as the map comes closer.
  const maxRank = f.zoom < 1.8 ? 4 : f.zoom < 3.5 ? 5 : 9;
  const rivers = new Path2D();
  const riverPath = geoPath(proj, pathContext(rivers));
  for (const feat of f.map.rivers.features) if ((feat.properties?.r ?? 9) <= maxRank) riverPath(feat);
  ctx.save();
  ctx.lineCap = "round";
  ctx.setLineDash([3, 2]);
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = "#a9c3dd";
  ctx.stroke(rivers);
  ctx.restore();

  // Lakes are cloth again.
  const lakes = new Path2D();
  geoPath(proj, pathContext(lakes))(f.map.lakes);
  ctx.fillStyle = oxford(f, cache);
  ctx.fill(lakes);

  // The satin edge, then a cream running stitch along it.
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = t.coast;
  ctx.lineWidth = 2.6;
  ctx.stroke(coast);
  ctx.setLineDash([2.6, 2.4]);
  ctx.strokeStyle = "#efe6cf";
  ctx.lineWidth = 0.9;
  ctx.stroke(coast);
  ctx.setLineDash([]);
  ctx.lineCap = "butt";
}

const NAVY = "#1d2b4d";
const LEATHER_LAND = "#2e5a3d";
const GOLD = "#d6b35e";

function drawDeskGlobe(f: SurfaceFrame, cache: ClubCache) {
  const { ctx, proj } = f;
  const [cx, cy] = proj.translate();
  const R = proj.scale();
  stand(f, cache, cx, cy, R);
  ctx.drawImage(cache.stand!.back, 0, 0, f.w, f.h);

  const sphere = new Path2D();
  sphere.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = NAVY;
  ctx.fill(sphere);
  ctx.save();
  ctx.clip(sphere);
  ctx.fillStyle = grain(f, cache);
  ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);

  const path = geoPath(proj, ctx);
  ctx.beginPath();
  path(TOOLING);
  ctx.setLineDash([1.5, 3]);
  ctx.strokeStyle = "rgba(214,179,94,0.45)";
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.setLineDash([]);

  const land = new Path2D();
  geoPath(proj, pathContext(land))(f.map.land);
  const coast = new Path2D();
  geoPath(proj, pathContext(coast))(f.map.coast);
  ctx.fillStyle = LEATHER_LAND;
  ctx.fill(land);
  ctx.fillStyle = grain(f, cache);
  ctx.fill(land);
  if (f.map.ice) {
    const ice = new Path2D();
    geoPath(proj, pathContext(ice))(f.map.ice);
    ctx.fillStyle = "#e9e0c8";
    ctx.fill(ice);
  }
  // Gold tooling: a bright line along the coast and a faint second line beside it.
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(214,179,94,0.35)";
  ctx.lineWidth = 3;
  ctx.stroke(coast);
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 1.4;
  ctx.stroke(coast);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 0.9;
  ctx.stroke(coast);

  // Lit from the upper left: a soft sheen, and the limb darkening.
  const sheen = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.45, R * 0.05, cx - R * 0.3, cy - R * 0.35, R * 0.9);
  sheen.addColorStop(0, "rgba(255,248,230,0.22)");
  sheen.addColorStop(1, "rgba(255,248,230,0)");
  ctx.fillStyle = sheen;
  ctx.fill(sphere);
  const limb = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
  limb.addColorStop(0, "rgba(8,12,24,0)");
  limb.addColorStop(1, "rgba(8,12,24,0.5)");
  ctx.fillStyle = limb;
  ctx.fill(sphere);
  ctx.restore();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "#0f1830";
  ctx.stroke(sphere);
  ctx.drawImage(cache.stand!.front, 0, 0, f.w, f.h);
}

/**
 * The brass half meridian and the turned stand, drawn once per frame size and globe radius: the stand and the
 * ring's far edge behind the globe, the ring's near face and its pivots in front.
 */
function stand(f: SurfaceFrame, cache: ClubCache, cx: number, cy: number, R: number) {
  const { w, h, dpr } = f;
  const key = `${w}:${h}:${dpr}:${Math.round(cx)}:${Math.round(cy)}:${Math.round(R)}`;
  if (cache.stand?.key === key) return;
  const tilt = (-20 * Math.PI) / 180;
  const ringR = R * 1.1;
  const band = Math.max(4, R * 0.05);
  const brass = (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) => {
    const b = g.createLinearGradient(x0, y0, x1, y1);
    b.addColorStop(0, "#f6e3a3");
    b.addColorStop(0.35, "#c99c3f");
    b.addColorStop(0.7, "#8a6420");
    b.addColorStop(1, "#d8b865");
    return b;
  };

  // Behind: the stand, its shadow on the desk and the ring's shadow on the globe's far side.
  const [back, g] = offscreen(w, h, dpr);
  const footY = cy + R * 1.36;
  const footW = R * 0.8;
  // The desk the globe stands on: a wooden top from just behind the foot to the bottom of the frame, with a
  // lighter front edge. It moves with the globe, so zooming in reads as leaning closer.
  const deskY = footY - R * 0.16;
  if (deskY < h) {
    const desk = g.createLinearGradient(0, deskY, 0, h);
    desk.addColorStop(0, "#6a4126");
    desk.addColorStop(0.5, "#57341e");
    desk.addColorStop(1, "#3f2615");
    g.fillStyle = desk;
    g.fillRect(0, deskY, w, h - deskY);
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(0, deskY, w, 2);
    g.fillStyle = "rgba(255,220,170,0.08)";
    for (let i = 0; i < 7; i++) g.fillRect(0, deskY + 6 + i * (R * 0.06 + 3), w, 1);
  }
  // Shadow on the desk.
  g.fillStyle = "rgba(20,14,8,0.28)";
  g.beginPath();
  g.ellipse(cx + R * 0.08, footY + R * 0.04, footW * 1.15, R * 0.1, 0, 0, Math.PI * 2);
  g.fill();
  // The foot: a leather-wrapped round base with a brass rim, seen from a little above.
  g.fillStyle = "#4a2a18";
  g.beginPath();
  g.ellipse(cx, footY - R * 0.03, footW, R * 0.12, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#6e3f22";
  g.beginPath();
  g.ellipse(cx, footY - R * 0.08, footW * 0.96, R * 0.1, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = brass(g, cx - footW, 0, cx + footW, 0);
  g.lineWidth = Math.max(1.5, R * 0.012);
  g.stroke();
  // The ring's south pivot, where the stand holds it.
  const px = cx - ringR * Math.sin(tilt);
  const py = cy + ringR * Math.cos(tilt);
  // The turned column: a baluster in brass from the foot up under the globe, then an arm to the pivot.
  const neckTop = Math.max(py + band * 1.5, cy + R * 1.12);
  g.lineCap = "round";
  g.lineWidth = band * 1.1;
  g.strokeStyle = brass(g, cx, neckTop, px, py);
  g.beginPath();
  g.moveTo(cx, neckTop + band);
  g.quadraticCurveTo(cx, py + band * 0.2, px, py);
  g.stroke();
  g.lineCap = "butt";
  const colW = R * 0.07;
  g.fillStyle = brass(g, cx - colW * 2, 0, cx + colW * 2, 0);
  g.beginPath();
  g.moveTo(cx - colW * 0.7, neckTop);
  g.bezierCurveTo(cx - colW * 0.7, neckTop + (footY - neckTop) * 0.3, cx - colW * 2.2, footY - R * 0.3, cx - colW * 1.4, footY - R * 0.12);
  g.lineTo(cx + colW * 1.4, footY - R * 0.12);
  g.bezierCurveTo(cx + colW * 2.2, footY - R * 0.3, cx + colW * 0.7, neckTop + (footY - neckTop) * 0.3, cx + colW * 0.7, neckTop);
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(70,48,14,0.6)";
  g.lineWidth = 1;
  g.stroke();
  // A collar where the column meets the ring.
  g.fillStyle = brass(g, cx - colW * 2, 0, cx + colW * 2, 0);
  g.beginPath();
  g.ellipse(cx, neckTop + band * 0.4, colW * 1.4, band * 0.7, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  // In front: the half meridian, a brass band from the north pivot round the right-hand side to the south pivot.
  const [front, fg] = offscreen(w, h, dpr);
  fg.save();
  fg.translate(cx, cy);
  fg.rotate(tilt);
  fg.lineCap = "butt";
  fg.lineWidth = band;
  fg.strokeStyle = brass(fg, -ringR, -ringR, ringR, ringR);
  fg.beginPath();
  fg.arc(0, 0, ringR, -Math.PI / 2, Math.PI / 2);
  fg.stroke();
  fg.lineWidth = 0.8;
  fg.strokeStyle = "rgba(70,48,14,0.7)";
  fg.beginPath();
  fg.arc(0, 0, ringR - band / 2, -Math.PI / 2, Math.PI / 2);
  fg.stroke();
  fg.beginPath();
  fg.arc(0, 0, ringR + band / 2, -Math.PI / 2, Math.PI / 2);
  fg.stroke();
  // Degree marks engraved on the ring.
  fg.beginPath();
  for (let a = -90; a <= 90; a += 10) {
    const r = (a * Math.PI) / 180;
    const c = Math.cos(r), s = Math.sin(r);
    fg.moveTo(c * (ringR - band / 2), s * (ringR - band / 2));
    fg.lineTo(c * (ringR - band / 2 + band * (a % 30 === 0 ? 0.7 : 0.4)), s * (ringR - band / 2 + band * (a % 30 === 0 ? 0.7 : 0.4)));
  }
  fg.stroke();
  // The pivots: a small brass cap at each pole of the tilted axis.
  for (const y of [-ringR, ringR]) {
    fg.fillStyle = brass(fg, -band, y - band, band, y + band);
    fg.beginPath();
    fg.arc(0, y, band * 0.9, 0, Math.PI * 2);
    fg.fill();
    fg.strokeStyle = "rgba(70,48,14,0.8)";
    fg.stroke();
  }
  fg.restore();
  cache.stand = { key, back, front };
}
