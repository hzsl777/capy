/**
 * Marker shapes (decision 72). Each design picks one; the shape carries no meaning. The three symbols of decision
 * 57 (hollow, filled, filled with an outer ring) are drawn from the same outline in every shape, and the map and
 * the Key both draw from these paths, so the Key always shows exactly what the map shows.
 *
 * Every path is centred on 0,0 and sized so the shape covers about as much as a circle of radius r.
 */

export type MarkShape = "circle" | "square" | "diamond" | "bevel" | "button" | "hex" | "pad" | "star4" | "star5" | "star6" | "flower" | "gumdrop" | "shield" | "block" | "shell" | "squircle" | "house" | "loop" | "x" | "pin" | "ticket" | "stub" | "teacup" | "nugget" | "cube" | "bean" | "slice" | "trilobe";

const f = (n: number) => n.toFixed(2);

function polygon(points: [number, number][]): string {
  return `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join("L")}Z`;
}

function star(points: number, outer: number, inner: number, turn = -Math.PI / 2): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = turn + (i * Math.PI) / points;
    const r = i % 2 ? inner : outer;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return polygon(pts);
}

/** The X's arm ends and bar width, as shares of r, and how far its corners reach from the centre. */
const X_END = 1.3;
const X_BAR = 0.6;
const X_REACH = Math.hypot(X_END, X_END - X_BAR);

/** How far a cube mark's corners reach, as a share of r, so it covers about as much as a circle of radius r. */
const CUBE_REACH = 1.1;

/**
 * A cube mark's lit top and shaded right face, and its three inner edges, as SVG path data centred on 0,0. Drawn over
 * a filled mark only, so hollow, filled and ringed read as in every shape.
 */
export function cubeFaces(r: number): { top: string; right: string; edges: string } {
  const R = r * CUBE_REACH;
  const c = R * Math.cos(Math.PI / 6);
  return {
    top: polygon([[0, -R], [c, -R / 2], [0, 0], [-c, -R / 2]]),
    right: polygon([[0, 0], [c, -R / 2], [c, R / 2], [0, R]]),
    edges: `M0 0L0 ${f(R)}M0 0L${f(c)} ${f(-R / 2)}M0 0L${f(-c)} ${f(-R / 2)}`,
  };
}

// Tiramisu (experimental): a coffee bean seen from its flat side, an oval laid at a slant, with the crease down its
// middle drawn over it (beanCrease). The oval alone is the mark, so hollow, filled and ringed read as in every shape.
/** The bean's half length and half width as shares of r (it covers about as much as a circle of radius r), and its slant. */
const BEAN_A = 1.2;
const BEAN_B = 0.86;
const BEAN_TURN = -0.45;

/** A point in the bean's own frame (u along its length, v across it), turned to its slant, as SVG numbers. */
function beanAt(u: number, v: number): string {
  const c = Math.cos(BEAN_TURN), s = Math.sin(BEAN_TURN);
  return `${f(u * c - v * s)} ${f(u * s + v * c)}`;
}

/** The crease down a bean's middle, a gentle S from end to end, as SVG path data centred on 0,0 (an open line). */
export function beanCrease(r: number): string {
  const a = r * BEAN_A, b = r * BEAN_B;
  return `M${beanAt(-0.8 * a, 0.06 * b)}C${beanAt(-0.3 * a, 0.44 * b)} ${beanAt(0.3 * a, -0.44 * b)} ${beanAt(0.8 * a, -0.06 * b)}`;
}

/** The outline of a marker of radius r, as SVG path data. */
export function markPath(shape: MarkShape, r: number): string {
  switch (shape) {
    case "square":
      return `M${f(-r)} ${f(-r)}H${f(r)}V${f(r)}H${f(-r)}Z`;
    case "diamond": {
      const d = r * 1.3;
      return polygon([[0, -d], [d, 0], [0, d], [-d, 0]]);
    }
    case "hex": {
      const pts: [number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        pts.push([r * 1.1 * Math.cos(a), r * 1.1 * Math.sin(a)]);
      }
      return polygon(pts);
    }
    case "pad": {
      // A lily pad: a disc with a notch cut toward its middle from the upper right.
      const R = r * 1.08;
      const a0 = -Math.PI / 3 + 0.3;
      const a1 = -Math.PI / 3 - 0.3;
      const tip: [number, number] = [0.3 * R * Math.cos(-Math.PI / 3), 0.3 * R * Math.sin(-Math.PI / 3)];
      return `M${f(tip[0])} ${f(tip[1])}L${f(R * Math.cos(a0))} ${f(R * Math.sin(a0))}A${f(R)} ${f(R)} 0 1 1 ${f(R * Math.cos(a1))} ${f(R * Math.sin(a1))}Z`;
    }
    case "star4":
      return star(4, r * 1.45, r * 0.5);
    case "star5":
      return star(5, r * 1.35, r * 0.6);
    case "star6":
      return star(6, r * 1.3, r * 0.72);
    case "flower": {
      // Six round petals.
      const n = 6;
      // Each petal is a half circle on the chord between two neighbouring points, so petals touch but never cross.
      const R = r * 0.85;
      const bulge = R * Math.sin(Math.PI / n) * 1.02;
      let d = "";
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const b = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
        const x0 = R * Math.cos(a);
        const y0 = R * Math.sin(a);
        const x1 = R * Math.cos(b);
        const y1 = R * Math.sin(b);
        d += `${i ? "" : `M${f(x0)} ${f(y0)}`}A${f(bulge)} ${f(bulge)} 0 0 1 ${f(x1)} ${f(y1)}`;
      }
      return `${d}Z`;
    }
    case "gumdrop": {
      // A rounded dome on a flat base.
      const w = r * 1.12;
      const top = -r * 1.1;
      const base = r * 0.85;
      return `M${f(-w)} ${f(base)}C${f(-w * 1.05)} ${f(top * 0.2)} ${f(-w * 0.6)} ${f(top)} 0 ${f(top)}C${f(w * 0.6)} ${f(top)} ${f(w * 1.05)} ${f(top * 0.2)} ${f(w)} ${f(base)}Q0 ${f(base + r * 0.3)} ${f(-w)} ${f(base)}Z`;
    }
    case "shield": {
      const w = r * 1.05;
      return `M${f(-w)} ${f(-r)}H${f(w)}V${f(r * 0.1)}C${f(w)} ${f(r * 0.7)} ${f(w * 0.4)} ${f(r * 1.05)} 0 ${f(r * 1.3)}C${f(-w * 0.4)} ${f(r * 1.05)} ${f(-w)} ${f(r * 0.7)} ${f(-w)} ${f(r * 0.1)}Z`;
    }
    case "block":
      // A terminal's character cell, taller than wide, the size of a block cursor (decision 74).
      return `M${f(-r * 0.8)} ${f(-r)}H${f(r * 0.8)}V${f(r)}H${f(-r * 0.8)}Z`;
    case "shell": {
      // A scallop shell (Aquarium, decision 77): a fan with a scalloped rim over two small ears at the hinge.
      const hy = r * 0.8;
      const R = r * 1.55;
      const n = 6;
      const a0 = (210 * Math.PI) / 180;
      const span = (120 * Math.PI) / 180;
      const at = (i: number): [number, number] => [R * Math.cos(a0 + (span * i) / n), hy + R * Math.sin(a0 + (span * i) / n)];
      const bump = R * Math.sin(span / n / 2) * 1.08;
      let d = `M${f(-r * 0.46)} ${f(r * 1.02)}L${f(-r * 0.4)} ${f(r * 0.62)}`;
      const [x0, y0] = at(0);
      d += `L${f(x0)} ${f(y0)}`;
      for (let i = 1; i <= n; i++) {
        const [x, y] = at(i);
        d += `A${f(bump)} ${f(bump)} 0 0 1 ${f(x)} ${f(y)}`;
      }
      return `${d}L${f(r * 0.4)} ${f(r * 0.62)}L${f(r * 0.46)} ${f(r * 1.02)}Z`;
    }
    case "squircle": {
      // A rounded square between a circle and a square, like a 1970s television screen (Lava Lamp, decision 77).
      const a = r * 0.93;
      const c = a * 0.9;
      return `M${f(-a)} 0C${f(-a)} ${f(-c)} ${f(-c)} ${f(-a)} 0 ${f(-a)}C${f(c)} ${f(-a)} ${f(a)} ${f(-c)} ${f(a)} 0C${f(a)} ${f(c)} ${f(c)} ${f(a)} 0 ${f(a)}C${f(-c)} ${f(a)} ${f(-a)} ${f(c)} ${f(-a)} 0Z`;
    }
    case "house": {
      // A little model house: square walls under a pitched roof (Toy Train Set, decision 76).
      const w = r * 0.95;
      return polygon([[-w, r * 0.95], [-w, -r * 0.2], [0, -r * 1.2], [w, -r * 0.2], [w, r * 0.95]]);
    }
    case "loop": {
      // A circle drawn by hand: its radius wanders a little, the same way every time (Chalkboard and Sketchbook,
      // decision 76). A smooth curve through ten points, from the middle of the last edge round to it again.
      const n = 10;
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const k = r * (1 + 0.07 * Math.sin(2 * a + 0.6) + 0.04 * Math.sin(3 * a + 2));
        pts.push([k * Math.cos(a), k * Math.sin(a)]);
      }
      const mid = (i: number): [number, number] => {
        const p = pts[i % n]!, q = pts[(i + 1) % n]!;
        return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      };
      const start = mid(n - 1);
      let d = `M${f(start[0])} ${f(start[1])}`;
      for (let i = 0; i < n; i++) {
        const m = mid(i);
        d += `Q${f(pts[i]![0])} ${f(pts[i]![1])} ${f(m[0])} ${f(m[1])}`;
      }
      return `${d}Z`;
    }
    case "pin": {
      // A map pin (Pin Drop): a round head over a point, the shape a guessing game drops on its map. The head and
      // the point share the centre, so the reticle and the Key sit on the pin as on every other mark.
      const R = r * 0.9;
      const cy = -r * 0.4;
      const tip = r * 1.5;
      // The point leaves the head where the lines from the tip touch it.
      const d = tip - cy;
      const a = Math.asin(R / d);
      const tx = R * Math.cos(a);
      const ty = cy + R * Math.sin(a);
      return `M0 ${f(tip)}L${f(-tx)} ${f(ty)}A${f(R)} ${f(R)} 0 1 1 ${f(tx)} ${f(ty)}Z`;
    }
    case "ticket": {
      // An order ticket off a deli's spike (Deli Counter): a slip of paper, taller than wide, its bottom edge torn
      // into teeth.
      const w = r * 0.8;
      const top = -r * 1.08;
      const valley = r * 0.72;
      const tooth = r * 1.08;
      const pts: [number, number][] = [[-w, top + r * 0.18], [-w + r * 0.18, top], [w - r * 0.18, top], [w, top + r * 0.18]];
      for (let k = 0; k <= 6; k++) pts.push([w - (k * 2 * w) / 6, k % 2 ? valley : tooth]);
      return polygon(pts);
    }
    case "stub": {
      // A cinema ticket stub (Marquee): wider than tall, with a round notch bitten out of each end.
      const w = r * 1.2;
      const hh = r * 0.78;
      const n = r * 0.36;
      return `M${f(-w)} ${f(-hh)}H${f(w)}V${f(-n)}A${f(n)} ${f(n)} 0 0 0 ${f(w)} ${f(n)}V${f(hh)}H${f(-w)}V${f(n)}A${f(n)} ${f(n)} 0 0 0 ${f(-w)} ${f(-n)}Z`;
    }
    case "teacup": {
      // A teacup seen from the side (Bedtime Tea): a wide rim, a bowl rounding down to a small foot, and a solid ear
      // of a handle on the right, so the outline stays one closed shape.
      const k = r * 1.12;
      const p = (x: number, y: number) => `${f(x * k)} ${f(y * k)}`;
      return (
        `M${p(-1, -0.62)}L${p(0.95, -0.62)}Q${p(0.96, -0.45)} ${p(0.93, -0.38)}` +
        `C${p(1.52, -0.52)} ${p(1.58, 0.2)} ${p(0.78, 0.2)}Q${p(0.64, 0.54)} ${p(0.42, 0.62)}` +
        `L${p(0.56, 0.72)}L${p(0.6, 0.84)}L${p(-0.6, 0.84)}L${p(-0.56, 0.72)}L${p(-0.42, 0.62)}` +
        `C${p(-0.8, 0.5)} ${p(-1, 0.05)} ${p(-1, -0.62)}Z`
      );
    }
    case "nugget": {
      // A candy cluster (Gummy Cluster): a lumpy round nugget, its rim a ring of uneven bumps, the same every time.
      const n = 7;
      const turn = [0, 0.12, -0.08, 0.1, -0.05, 0.08, -0.1];
      const reach = [0.9, 0.84, 0.92, 0.86, 0.9, 0.82, 0.88];
      const bump = [0.5, 0.4, 0.46, 0.36, 0.48, 0.42, 0.44];
      const pts = Array.from({ length: n }, (_, i): [number, number] => {
        const a = ((i + turn[i]!) / n) * Math.PI * 2 - Math.PI / 2;
        return [r * reach[i]! * Math.cos(a), r * reach[i]! * Math.sin(a)];
      });
      let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
      for (let i = 0; i < n; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % n]!;
        // Each bump is a short arc bulging outward; its radius never falls below half its chord, so the arc exists.
        const br = Math.max(r * bump[i]!, (Math.hypot(b[0] - a[0], b[1] - a[1]) / 2) * 1.02);
        d += `A${f(br)} ${f(br)} 0 0 1 ${f(b[0])} ${f(b[1])}`;
      }
      return `${d}Z`;
    }
    case "cube": {
      // A small cube seen from a corner (Folding Cube): its outline is a hexagon with a point up. The map draws the
      // three faces' light and shade and the edges inside it (cubeFaces); the outline alone is the mark.
      const R = r * CUBE_REACH;
      const c = R * Math.cos(Math.PI / 6);
      return polygon([[0, -R], [c, -R / 2], [c, R / 2], [0, R], [-c, R / 2], [-c, -R / 2]]);
    }
    case "bean": {
      // An oval in four quarter curves (the usual 0.5523 handles), turned to the bean's slant.
      const a = r * BEAN_A, b = r * BEAN_B, k = 0.5523;
      return (
        `M${beanAt(a, 0)}C${beanAt(a, k * b)} ${beanAt(k * a, b)} ${beanAt(0, b)}C${beanAt(-k * a, b)} ${beanAt(-a, k * b)} ${beanAt(-a, 0)}` +
        `C${beanAt(-a, -k * b)} ${beanAt(-k * a, -b)} ${beanAt(0, -b)}C${beanAt(k * a, -b)} ${beanAt(a, -k * b)} ${beanAt(a, 0)}Z`
      );
    }
    case "slice": {
      // A round slice of garnish (Noodle Bowl): a disc whose rim is nine shallow scallops, the same every time.
      const n = 9;
      const R = r * 0.93;
      const pt = (i: number): [number, number] => [R * Math.cos((i / n) * Math.PI * 2 - Math.PI / 2), R * Math.sin((i / n) * Math.PI * 2 - Math.PI / 2)];
      const chord = 2 * R * Math.sin(Math.PI / n);
      const br = (chord / 2) * 1.1;
      const [x0, y0] = pt(0);
      let d = `M${f(x0)} ${f(y0)}`;
      for (let i = 1; i <= n; i++) {
        const [x, y] = pt(i % n);
        d += `A${f(br)} ${f(br)} 0 0 1 ${f(x)} ${f(y)}`;
      }
      return `${d}Z`;
    }
    case "trilobe": {
      // Three rounded lobes in one outline, like a small seed pod (Alien): circles of radius 0.58 r whose centres lie
      // 0.5 r from the middle at 120 degrees, joined along the outer edge where neighbours cross.
      const d = r * 0.5, rho = r * 0.58;
      const a = (k: number) => -Math.PI / 2 + (k * 2 * Math.PI) / 3;
      const half = Math.sqrt(rho * rho - (d * Math.sqrt(3)) ** 2 / 4);
      // The crossing of lobes k and k+1 that lies farther from the middle, on the bisector between their centres.
      const cross = (k: number): [number, number] => {
        const m = a(k) + Math.PI / 3;
        const o = d / 2 + half;
        return [o * Math.cos(m), o * Math.sin(m)];
      };
      let path = "";
      for (let k = 0; k < 3; k++) {
        const [sx, sy] = cross((k + 2) % 3);
        const [ex, ey] = cross(k);
        path += `${k ? "" : `M${f(sx)} ${f(sy)}`}A${f(rho)} ${f(rho)} 0 1 1 ${f(ex)} ${f(ey)}`;
      }
      return `${path}Z`;
    }
    case "x": {
      // X marks the spot (Pirate): two crossed bars with square-cut ends. Its ring is a circle round the whole X
      // (markRing), since an X drawn larger would sit too close to read as a ring.
      const e = r * X_END;
      const h = r * X_BAR;
      return polygon([[-e, -e + h], [-e + h, -e], [0, -h], [e - h, -e], [e, -e + h], [h, 0], [e, e - h], [e - h, e], [0, h], [-e + h, e], [-e, e - h], [-h, 0]]);
    }
    default:
      // circle, bevel and button
      return `M${f(-r)} 0A${f(r)} ${f(r)} 0 1 0 ${f(r)} 0A${f(r)} ${f(r)} 0 1 0 ${f(-r)} 0Z`;
  }
}

/**
 * The outer ring of a marker of radius r, `gap` outside it: the same outline drawn larger, or for the X a circle
 * round its corners.
 */
export function markRing(shape: MarkShape, r: number, gap: number): string {
  return shape === "x" ? markPath("circle", r * X_REACH + gap) : markPath(shape, r + gap);
}

const cache = new Map<string, Path2D>();

/** The same outline as a Path2D centred on 0,0, cached by shape and size (to a quarter pixel). */
export function markPath2D(shape: MarkShape, r: number): Path2D {
  const q = Math.round(r * 4) / 4;
  const key = `${shape}:${q}`;
  let p = cache.get(key);
  if (!p) {
    p = new Path2D(markPath(shape, q));
    if (cache.size > 4000) cache.clear();
    cache.set(key, p);
  }
  return p;
}

const faceCache = new Map<number, { top: Path2D; right: Path2D; edges: Path2D }>();

/** cubeFaces as Path2Ds centred on 0,0, cached by size (to a quarter pixel). */
export function cubeFaces2D(r: number): { top: Path2D; right: Path2D; edges: Path2D } {
  const q = Math.round(r * 4) / 4;
  let p = faceCache.get(q);
  if (!p) {
    const d = cubeFaces(q);
    p = { top: new Path2D(d.top), right: new Path2D(d.right), edges: new Path2D(d.edges) };
    if (faceCache.size > 400) faceCache.clear();
    faceCache.set(q, p);
  }
  return p;
}

const creaseCache = new Map<number, Path2D>();

/** beanCrease as a Path2D centred on 0,0, cached by size (to a quarter pixel). */
export function beanCrease2D(r: number): Path2D {
  const q = Math.round(r * 4) / 4;
  let p = creaseCache.get(q);
  if (!p) {
    p = new Path2D(beanCrease(q));
    if (creaseCache.size > 400) creaseCache.clear();
    creaseCache.set(q, p);
  }
  return p;
}

/** markRing as a Path2D centred on 0,0. */
export function markRing2D(shape: MarkShape, r: number, gap: number): Path2D {
  return shape === "x" ? markPath2D("circle", r * X_REACH + gap) : markPath2D(shape, r + gap);
}
