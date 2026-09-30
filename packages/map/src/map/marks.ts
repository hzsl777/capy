/**
 * Marker shapes (decision 72). Each design picks one; the shape carries no meaning. The three symbols of decision
 * 57 (hollow, filled, filled with an outer ring) are drawn from the same outline in every shape, and the map and
 * the Key both draw from these paths, so the Key always shows exactly what the map shows.
 *
 * Every path is centred on 0,0 and sized so the shape covers about as much as a circle of radius r.
 */

export type MarkShape = "circle" | "square" | "diamond" | "bevel" | "button" | "hex" | "pad" | "star4" | "star5" | "star6" | "flower" | "gumdrop" | "shield" | "house" | "loop";

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
    default:
      // circle, bevel and button
      return `M${f(-r)} 0A${f(r)} ${f(r)} 0 1 0 ${f(r)} 0A${f(r)} ${f(r)} 0 1 0 ${f(-r)} 0Z`;
  }
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
