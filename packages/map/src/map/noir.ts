// Film Noir (decision 75): a black-and-white 1940s detective film. The flat map lies on a desk, seen from the chair
// under a canted camera (the "desk" warp); the globe stands on its own stand. A desk lamp throws a gentle pool of
// light where the reticle is, and the shadows of window blinds fall across everything in soft bars. Grey land, near
// black sea, a pale coast. The lamp and the blinds never move, so nothing flashes; the rain on the glass is CSS. No
// text, no borders, and the light falls on the screen, never on a place.

import { geoGraticule, geoPath } from "d3-geo";
import { hash2, offscreen, pathContext, type SurfaceFrame, type SurfaceResult } from "./surface.ts";

const GRID = geoGraticule().step([15, 15])();
const SPHERE = { type: "Sphere" } as const;

/** What the scene keeps between frames: the desk, and the light and shadow laid over the map. */
export class NoirCache {
  desk?: { key: string; canvas: HTMLCanvasElement };
  light?: { key: string; canvas: HTMLCanvasElement };
  stand?: { key: string; canvas: HTMLCanvasElement };
  grain?: HTMLCanvasElement;
}

/** A dark wooden desk top, its grain running across the frame, drawn once per size. */
function desk(w: number, h: number, dpr: number): HTMLCanvasElement {
  const [c, g] = offscreen(w, h, dpr);
  const top = g.createLinearGradient(0, 0, 0, h);
  top.addColorStop(0, "#050505");
  top.addColorStop(1, "#1a1a19");
  g.fillStyle = top;
  g.fillRect(0, 0, w, h);
  g.lineCap = "round";
  for (let i = 0; i < 140; i++) {
    const y = hash2(i, 1) * h;
    const x0 = hash2(i, 2) * w * 0.6 - w * 0.2;
    const len = w * (0.3 + hash2(i, 3) * 0.8);
    g.strokeStyle = hash2(i, 4) < 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.3)";
    g.lineWidth = 0.6 + hash2(i, 5) * 1.6;
    g.beginPath();
    g.moveTo(x0, y);
    g.bezierCurveTo(x0 + len * 0.3, y + (hash2(i, 6) - 0.5) * 10, x0 + len * 0.7, y + (hash2(i, 7) - 0.5) * 10, x0 + len, y + (hash2(i, 8) - 0.5) * 6);
    g.stroke();
  }
  // On the desk, where the map or globe leaves room: a hat with a band, and a cup of coffee on its saucer.
  const s = Math.min(w, h) * 0.16;
  hat(g, w * 0.1 + s * 0.3, h - s * 0.55, s);
  cup(g, w - s * 1.5, h - s * 0.6, s * 0.7);
  return c;
}

/** A felt hat seen from the side, in greys: a pinched crown, a band, a curled brim. */
function hat(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.12);
  g.fillStyle = "rgba(0,0,0,0.55)";
  g.beginPath();
  g.ellipse(s * 0.06, s * 0.14, s * 0.62, s * 0.12, 0, 0, Math.PI * 2);
  g.fill();
  const felt = g.createLinearGradient(-s * 0.5, -s * 0.5, s * 0.5, s * 0.1);
  felt.addColorStop(0, "#5a5955");
  felt.addColorStop(1, "#1e1e1d");
  g.fillStyle = felt;
  g.beginPath();
  g.ellipse(0, 0, s * 0.6, s * 0.14, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(-s * 0.34, -s * 0.02);
  g.bezierCurveTo(-s * 0.36, -s * 0.34, -s * 0.24, -s * 0.46, -s * 0.06, -s * 0.4);
  g.quadraticCurveTo(0, -s * 0.33, s * 0.06, -s * 0.4);
  g.bezierCurveTo(s * 0.24, -s * 0.46, s * 0.36, -s * 0.34, s * 0.34, -s * 0.02);
  g.closePath();
  g.fill();
  g.fillStyle = "#101010";
  g.beginPath();
  g.moveTo(-s * 0.345, -s * 0.06);
  g.lineTo(s * 0.345, -s * 0.06);
  g.lineTo(s * 0.34, -s * 0.15);
  g.lineTo(-s * 0.34, -s * 0.15);
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.18)";
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(0, 0, s * 0.6, s * 0.14, 0, Math.PI * 1.05, Math.PI * 1.95);
  g.stroke();
  g.restore();
}

/** A cup of coffee on a saucer, seen from above and a little to the side, with one curl of steam. */
function cup(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.save();
  g.translate(x, y);
  g.fillStyle = "rgba(0,0,0,0.5)";
  g.beginPath();
  g.ellipse(s * 0.08, s * 0.1, s * 0.62, s * 0.24, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#6f6e69";
  g.beginPath();
  g.ellipse(0, 0, s * 0.6, s * 0.22, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#8c8b86";
  g.beginPath();
  g.moveTo(-s * 0.3, -s * 0.36);
  g.lineTo(s * 0.3, -s * 0.36);
  g.quadraticCurveTo(s * 0.28, 0, 0, s * 0.02);
  g.quadraticCurveTo(-s * 0.28, 0, -s * 0.3, -s * 0.36);
  g.fill();
  g.strokeStyle = "#8c8b86";
  g.lineWidth = s * 0.06;
  g.beginPath();
  g.ellipse(s * 0.34, -s * 0.2, s * 0.1, s * 0.08, 0, -Math.PI / 2, Math.PI / 2);
  g.stroke();
  g.fillStyle = "#b3b1aa";
  g.beginPath();
  g.ellipse(0, -s * 0.36, s * 0.3, s * 0.09, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#1b1a18";
  g.beginPath();
  g.ellipse(0, -s * 0.355, s * 0.25, s * 0.07, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(230,228,220,0.18)";
  g.lineWidth = 2;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(-s * 0.04, -s * 0.5);
  g.bezierCurveTo(-s * 0.18, -s * 0.7, s * 0.14, -s * 0.8, 0, -s * 1.02);
  g.stroke();
  g.restore();
}

/**
 * Light and shade over the map, fixed to the screen: the lamp's pool centred on the reticle, its cone coming in
 * from the upper left, the room dark toward the corners, and the soft bars of blinds falling across from the upper
 * right. Drawn once per size, laid over with one image.
 */
function light(w: number, h: number, dpr: number): HTMLCanvasElement {
  const [c, g] = offscreen(w, h, dpr);
  const cx = w / 2, cy = h / 2;
  const reach = Math.hypot(w, h) / 2;
  // The room: darker away from the lamp.
  const room = g.createRadialGradient(cx, cy, reach * 0.18, cx, cy, reach * 1.05);
  room.addColorStop(0, "rgba(0,0,0,0)");
  room.addColorStop(0.55, "rgba(0,0,0,0.3)");
  room.addColorStop(1, "rgba(0,0,0,0.72)");
  g.fillStyle = room;
  g.fillRect(0, 0, w, h);
  // Blinds: soft bars of shadow at a slant, strongest toward the upper right, where the window is.
  const [bc, bg] = offscreen(w, h, dpr);
  bg.save();
  bg.translate(w * 0.85, -h * 0.1);
  bg.rotate(0.5);
  const pitch = Math.max(26, Math.min(w, h) * 0.075);
  for (let y = -reach * 2.5; y < reach * 2.5; y += pitch) {
    const bar = bg.createLinearGradient(0, y, 0, y + pitch * 0.55);
    bar.addColorStop(0, "rgba(0,0,0,0)");
    bar.addColorStop(0.35, "rgba(0,0,0,0.5)");
    bar.addColorStop(0.65, "rgba(0,0,0,0.5)");
    bar.addColorStop(1, "rgba(0,0,0,0)");
    bg.fillStyle = bar;
    bg.fillRect(-reach * 3, y, reach * 6, pitch * 0.55);
  }
  bg.restore();
  // The blinds' light falls off toward the lower left, and the lamp's pool washes them out where it shines.
  bg.globalCompositeOperation = "destination-in";
  const fall = bg.createLinearGradient(w, 0, w * 0.15, h);
  fall.addColorStop(0, "rgba(0,0,0,1)");
  fall.addColorStop(0.6, "rgba(0,0,0,0.75)");
  fall.addColorStop(1, "rgba(0,0,0,0.25)");
  bg.fillStyle = fall;
  bg.fillRect(0, 0, w, h);
  g.drawImage(bc, 0, 0, w, h);
  // The lamp's cone, a faint wedge in the air from the upper left, and its pool round the reticle.
  g.save();
  const lx = -w * 0.05, ly = -h * 0.12;
  const pr = Math.min(w, h) * 0.3;
  const ang = Math.atan2(cy - ly, cx - lx);
  const spread = Math.atan2(pr, Math.hypot(cx - lx, cy - ly));
  const cone = g.createLinearGradient(lx, ly, cx, cy);
  cone.addColorStop(0, "rgba(255,252,240,0.1)");
  cone.addColorStop(1, "rgba(255,252,240,0.03)");
  g.fillStyle = cone;
  g.beginPath();
  g.moveTo(lx, ly);
  g.lineTo(lx + Math.cos(ang - spread) * reach * 3, ly + Math.sin(ang - spread) * reach * 3);
  g.lineTo(lx + Math.cos(ang + spread) * reach * 3, ly + Math.sin(ang + spread) * reach * 3);
  g.closePath();
  g.fill();
  g.restore();
  const pool = g.createRadialGradient(cx, cy, 0, cx, cy, pr * 1.3);
  pool.addColorStop(0, "rgba(255,252,240,0.2)");
  pool.addColorStop(0.5, "rgba(255,252,240,0.1)");
  pool.addColorStop(1, "rgba(255,252,240,0)");
  g.fillStyle = pool;
  g.fillRect(0, 0, w, h);
  return c;
}

/** A film grain tile, laid over the sea so it reads as a photograph. */
function grainTile(): HTMLCanvasElement {
  const N = 96;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d")!;
  const img = g.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const v = hash2(i % N, Math.floor(i / N) + 0.37);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v < 0.5 ? 0 : 255;
    img.data[i * 4 + 3] = Math.round(Math.abs(v - 0.5) * 60);
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * The globe's stand: a brass meridian ring half round the globe and a turned wooden foot below it, in greys. Drawn
 * once per globe size, behind and around the globe.
 */
function stand(w: number, h: number, dpr: number, R: number, roll: number): HTMLCanvasElement {
  const [c, g] = offscreen(w, h, dpr);
  const cx = w / 2, cy = h / 2;
  g.translate(cx, cy);
  g.rotate(roll);
  // The foot: a stem and a round base in shadow under the globe.
  const foot = g.createLinearGradient(-R * 0.3, 0, R * 0.3, 0);
  foot.addColorStop(0, "#1c1c1b");
  foot.addColorStop(0.4, "#6d6c68");
  foot.addColorStop(1, "#151514");
  g.fillStyle = foot;
  g.beginPath();
  g.moveTo(-R * 0.06, R * 1.05);
  g.lineTo(R * 0.06, R * 1.05);
  g.lineTo(R * 0.1, R * 1.24);
  g.lineTo(-R * 0.1, R * 1.24);
  g.closePath();
  g.fill();
  g.beginPath();
  g.ellipse(0, R * 1.28, R * 0.42, R * 0.08, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(0,0,0,0.5)";
  g.beginPath();
  g.ellipse(R * 0.05, R * 1.36, R * 0.55, R * 0.06, 0, 0, Math.PI * 2);
  g.fill();
  // The meridian ring, drawn round the back half so the globe sits inside it.
  const ring = g.createLinearGradient(-R, -R, R, R);
  ring.addColorStop(0, "#d8d6cf");
  ring.addColorStop(0.5, "#7a7873");
  ring.addColorStop(1, "#2a2a28");
  g.strokeStyle = ring;
  g.lineWidth = Math.max(3, R * 0.035);
  g.beginPath();
  g.arc(0, 0, R * 1.06, -Math.PI * 0.62, Math.PI * 0.62);
  g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = "rgba(0,0,0,0.6)";
  g.beginPath();
  g.arc(0, 0, R * 1.06 + g.lineWidth * 2, -Math.PI * 0.62, Math.PI * 0.62);
  g.stroke();
  return c;
}

export function drawNoir(f: SurfaceFrame, cache: NoirCache): SurfaceResult {
  const { ctx, w, h, dpr, proj, mode, theme: t } = f;
  const globe = mode === "3d";
  const R = proj.scale();
  const key = `${w}:${h}:${dpr}`;
  if (cache.desk?.key !== key) cache.desk = { key, canvas: desk(w, h, dpr) };
  if (cache.light?.key !== key) cache.light = { key, canvas: light(w, h, dpr) };
  cache.grain ??= grainTile();
  ctx.drawImage(cache.desk.canvas, 0, 0, w, h);

  const path = (o: object) => {
    const p = new Path2D();
    geoPath(f.view as never, pathContext(p))(o as never);
    return p;
  };
  const sheet = path(SPHERE);
  if (globe) {
    const sk = `${key}:${Math.round(R)}`;
    if (cache.stand?.key !== sk) cache.stand = { key: sk, canvas: stand(w, h, dpr, R, (-5 * Math.PI) / 180) };
    ctx.drawImage(cache.stand.canvas, 0, 0, w, h);
  } else {
    // The map sheet casts a shadow on the desk.
    ctx.save();
    ctx.translate(4, 7);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fill(sheet);
    ctx.restore();
  }
  ctx.fillStyle = t.ocean;
  ctx.fill(sheet);
  ctx.save();
  ctx.clip(sheet);
  const grain = ctx.createPattern(cache.grain, "repeat")!;
  ctx.fillStyle = grain;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = t.graticule;
  ctx.lineWidth = 0.6;
  ctx.stroke(path(GRID));

  const land = path(f.map.land);
  const coast = path(f.map.coast);
  // Land lifts off the sea a little: a dark offset under it, then grey, then a pale line on the coast.
  ctx.save();
  ctx.translate(1.5, 2.5);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fill(land);
  ctx.restore();
  const tone = ctx.createLinearGradient(0, 0, 0, h);
  tone.addColorStop(0, "#8b8a84");
  tone.addColorStop(1, t.land);
  ctx.fillStyle = tone;
  ctx.fill(land);
  if (f.map.ice) {
    ctx.fillStyle = t.ice;
    ctx.fill(path(f.map.ice));
  }
  ctx.fillStyle = grain;
  ctx.fill(land);
  // Mountains as short engraved strokes, in the dark ink of the relief.
  if (f.relief && f.warp) {
    const s = Math.min(5, 2 + f.zoom * 0.4);
    const marks: string[] = [];
    const c0 = [f.lon, f.lat];
    for (const [lon, lat] of f.relief.peaks) {
      if (globe) {
        const dl = ((((lon - c0[0]!) % 360) + 540) % 360) - 180;
        if (Math.abs(dl) > 90 || Math.abs(lat - c0[1]!) > 80) continue;
      }
      const p = proj([lon, lat]);
      if (!p) continue;
      const [x, y] = f.warp.fwd(p[0], p[1]);
      if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
      marks.push(`M${(x - s).toFixed(1)} ${(y + s * 0.5).toFixed(1)}L${x.toFixed(1)} ${(y - s * 0.7).toFixed(1)}L${(x + s).toFixed(1)} ${(y + s * 0.5).toFixed(1)}`);
    }
    ctx.strokeStyle = "rgba(20,20,19,0.55)";
    ctx.lineWidth = 0.9;
    ctx.stroke(new Path2D(marks.join("")));
  }
  ctx.strokeStyle = t.coast;
  ctx.lineWidth = t.coastWidth;
  ctx.stroke(coast);
  if (globe) {
    // A lit sphere: a pale highlight toward the lamp, shadow toward the far rim.
    const [gx, gy] = [w / 2, h / 2];
    const shade = ctx.createRadialGradient(gx - R * 0.35, gy - R * 0.4, R * 0.1, gx, gy, R * 1.02);
    shade.addColorStop(0, "rgba(255,255,255,0.12)");
    shade.addColorStop(0.6, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(242,240,232,0.5)";
  ctx.lineWidth = 1;
  ctx.stroke(sheet);

  ctx.drawImage(cache.light.canvas, 0, 0, w, h);
  return {};
}
