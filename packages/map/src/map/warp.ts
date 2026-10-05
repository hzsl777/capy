// Cameras that bend the whole picture after it is projected (decision 75): Arcade Cabinet's curved picture tube,
// Stadium Jumbotron's screen seen at an angle from the stands, and Film Noir's map lying on a desk under a canted
// camera. Land, sea, arcs and places all go through the same warp, so a marker sits where its place is drawn, and
// tapping and tuning read the warped screen. The frame's centre never moves, so the reticle stays on the tuned place.

import type { GeoStream } from "d3-geo";

export type WarpKind = "barrel" | "stadium" | "desk" | "wobble";

export interface Warp {
  kind: WarpKind;
  /** A point of the flat picture to the screen. */
  fwd(x: number, y: number): [number, number];
  /** A point on the screen back to the flat picture. */
  inv(x: number, y: number): [number, number];
  /** Straight steps longer than this (pixels) are split before warping, so lines curve with a lens. 0 keeps lines straight. */
  split: number;
  /** A drag on the screen as a drag of the flat picture under the centre. */
  unpan(dx: number, dy: number): [number, number];
}

const RAD = Math.PI / 180;

/**
 * A picture tube's barrel curve: the picture bulges toward you, so points are pulled in more the further they are
 * from the centre. `k` is how far the corners come in, as a share of the half diagonal.
 */
export function barrel(w: number, h: number, k = 0.11): Warp {
  const cx = w / 2, cy = h / 2;
  const d2 = cx * cx + cy * cy;
  const fwd = (x: number, y: number): [number, number] => {
    const dx = x - cx, dy = y - cy;
    const f = 1 - (k * (dx * dx + dy * dy)) / d2;
    return [cx + dx * f, cy + dy * f];
  };
  const inv = (x: number, y: number): [number, number] => {
    const dx = x - cx, dy = y - cy;
    const rd = Math.hypot(dx, dy);
    if (rd < 1e-9) return [cx, cy];
    // Solve rd = r (1 - k r^2 / d2) for r by Newton's method, starting from rd.
    let r = rd;
    for (let i = 0; i < 6; i++) {
      const g = r * (1 - (k * r * r) / d2) - rd;
      const dg = 1 - (3 * k * r * r) / d2;
      r -= g / Math.max(0.2, dg);
    }
    return [cx + (dx / rd) * r, cy + (dy / rd) * r];
  };
  return { kind: "barrel", fwd, inv, split: 6, unpan: (dx, dy) => [dx, dy] };
}

/**
 * A flat picture turned in space and seen in perspective: `yaw` turns it about the vertical axis (positive moves the
 * right side away), `pitch` about the horizontal one (negative moves the top away), the eye sits `eye` frame heights
 * in front, `scale` sizes the picture, and `roll` turns the camera (a canted angle). Lines stay straight.
 */
export function plane(kind: WarpKind, w: number, h: number, o: { yaw: number; pitch: number; eye: number; scale: number; roll: number }): Warp {
  const cx = w / 2, cy = h / 2;
  const ca = Math.cos(o.yaw * RAD), sa = Math.sin(o.yaw * RAD);
  const cb = Math.cos(o.pitch * RAD), sb = Math.sin(o.pitch * RAD);
  const cr = Math.cos(o.roll * RAD), sr = Math.sin(o.roll * RAD);
  const d = o.eye * h;
  const m = o.scale;
  const fwd = (x: number, y: number): [number, number] => {
    const u = (x - cx) * m, v = (y - cy) * m;
    const px = u * ca;
    const py = v * cb - u * sa * sb;
    const pz = v * sb + u * sa * cb;
    const s = d / Math.max(d * 0.2, d + pz);
    const X = px * s, Y = py * s;
    return [cx + X * cr - Y * sr, cy + X * sr + Y * cr];
  };
  const inv = (x: number, y: number): [number, number] => {
    const rx = x - cx, ry = y - cy;
    const X = rx * cr + ry * sr, Y = -rx * sr + ry * cr;
    // X (d + z) = d x and Y (d + z) = d y, with x, y, z linear in u and v: two equations in u and v.
    const a11 = X * sa * cb - d * ca, a12 = X * sb, b1 = -X * d;
    const a21 = Y * sa * cb + d * sa * sb, a22 = Y * sb - d * cb, b2 = -Y * d;
    const det = a11 * a22 - a12 * a21 || 1e-9;
    const u = (b1 * a22 - a12 * b2) / det;
    const v = (a11 * b2 - b1 * a21) / det;
    return [cx + u / m, cy + v / m];
  };
  const unpan = (dx: number, dy: number): [number, number] => {
    const X = dx * cr + dy * sr, Y = -dx * sr + dy * cr;
    return [X / (m * ca), Y / (m * cb)];
  };
  return { kind, fwd, inv, split: 0, unpan };
}

/**
 * The warp a design asks for, sized to the frame. The desk camera only cants in Globe view: a globe on a desk stays
 * round, while the flat map lies back on the desk.
 */
export function makeWarp(kind: WarpKind, w: number, h: number, globe = false): Warp {
  // "wobble" (Noodle Bowl) is made frame by frame from how far the view has moved (src/map/soup.ts), never here.
  if (kind === "barrel") return barrel(w, h);
  if (kind === "stadium") return plane(kind, w, h, { yaw: 13, pitch: -8, eye: 1.5, scale: 0.76, roll: 0 });
  return plane(kind, w, h, globe ? { yaw: 0, pitch: 0, eye: 1.6, scale: 1, roll: -5 } : { yaw: 0, pitch: -24, eye: 1.6, scale: 1.02, roll: -5 });
}

/**
 * A d3 stream that warps every point. With `split`, long steps are cut into short ones first, so a straight line
 * bends as the lens bends it; rings close through the split as well.
 */
export function warpStream(out: GeoStream, warp: Warp): GeoStream {
  const step = warp.split;
  let inPoly = false;
  let x0 = NaN, y0 = NaN, xf = NaN, yf = NaN;
  const emit = (x: number, y: number) => {
    const q = warp.fwd(x, y);
    out.point(q[0], q[1]);
  };
  const to = (x: number, y: number) => {
    if (step > 0 && x0 === x0) {
      const n = Math.floor(Math.hypot(x - x0, y - y0) / step);
      for (let i = 1; i <= n; i++) emit(x0 + ((x - x0) * i) / (n + 1), y0 + ((y - y0) * i) / (n + 1));
    }
    emit(x, y);
    if (xf !== xf) {
      xf = x;
      yf = y;
    }
    x0 = x;
    y0 = y;
  };
  return {
    point: (x, y) => to(x, y),
    lineStart: () => {
      x0 = y0 = xf = yf = NaN;
      out.lineStart();
    },
    lineEnd: () => {
      // A ring's closing step, from its last point back to its first, is split like the others.
      if (inPoly && step > 0 && xf === xf && (x0 !== xf || y0 !== yf)) {
        const n = Math.floor(Math.hypot(xf - x0, yf - y0) / step);
        for (let i = 1; i <= n; i++) emit(x0 + ((xf - x0) * i) / (n + 1), y0 + ((yf - y0) * i) / (n + 1));
      }
      out.lineEnd();
    },
    polygonStart: () => {
      inPoly = true;
      out.polygonStart();
    },
    polygonEnd: () => {
      inPoly = false;
      out.polygonEnd();
    },
    sphere: () => out.sphere?.(),
  };
}
