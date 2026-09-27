import {
  geoDistance,
  geoGraticule,
  geoInterpolate,
  geoOrthographic,
  geoPath,
  type GeoPermissibleObjects,
  type GeoProjection,
} from "d3-geo";
import type { Theme, ViewMode } from "../themes.ts";
import type { Basemap, Relief } from "./basemap.ts";

export interface Dot {
  /** Index into NewsFile.places. */
  index: number;
  lon: number;
  lat: number;
  count: number;
  fresh: boolean;
}

export interface MapEvents {
  /** The place under the crosshair changed (null when nothing is in reach). */
  onTune(index: number | null): void;
  /** Any change of position, zoom or mode. */
  onMove?(): void;
}

const SPHERE: GeoPermissibleObjects = { type: "Sphere" };
const GRATICULE = geoGraticule().step([15, 15])();
const DEG = 180 / Math.PI;
const TUNE_RADIUS = 30;
const MAX_ZOOM = 14;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Anim {
  start: number;
  duration: number;
  step(t: number): void;
}

/**
 * Canvas map in two modes: a flat projection (lon wraps as you drag) or an
 * orthographic globe. The position under the screen centre is the "tuned" spot,
 * like the crosshair in Radio Garden.
 */
export class MapView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private baseScale = 1;

  lon = 15;
  lat = 15;
  zoom = 1;
  mode: ViewMode = "2d";
  theme: Theme;

  private low?: Basemap;
  private high?: Basemap;
  private relief?: Relief;
  private dots: Dot[] = [];
  private screen: { index: number; x: number; y: number; r: number }[] = [];
  private tuned: number | null = null;
  private pinned = new Set<number>();
  private arcs: { from: [number, number]; to: [number, number][] } | null = null;
  /** Places tied to what the panel shows (the telegram's events, or one event). Drawn with a dashed ring. */
  private highlight = new Set<number>();

  private interacting = false;
  private anim: Anim | null = null;
  private frame = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; t: number } | null = null;
  private velocity = { x: 0, y: 0, t: 0 };
  private pinch: { dist: number; zoom: number } | null = null;
  private patterns = new Map<string, CanvasPattern>();

  constructor(
    private container: HTMLElement,
    theme: Theme,
    private events: MapEvents,
  ) {
    this.theme = theme;
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Map of reported places. Drag to turn, scroll to zoom.");
    this.canvas.tabIndex = 0;
    container.prepend(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(container);
    this.bindInput();
    this.resize();
  }

  // ---- public API -------------------------------------------------------

  setBasemap(low?: Basemap, high?: Basemap, relief?: Relief) {
    if (low) this.low = low;
    if (high) this.high = high;
    if (relief) this.relief = relief;
    this.request();
  }

  setTheme(theme: Theme) {
    this.theme = theme;
    this.patterns.clear();
    this.fit();
    this.request();
  }

  setMode(mode: ViewMode) {
    this.mode = mode;
    this.fit();
    this.request();
  }

  setDots(dots: Dot[]) {
    this.dots = [...dots].sort((a, b) => a.count - b.count);
    this.request();
  }

  setPinned(indices: Iterable<number>) {
    this.pinned = new Set(indices);
    this.request();
  }

  setHighlight(indices: Iterable<number>) {
    this.highlight = new Set(indices);
    this.request();
  }

  setArcs(from: [number, number] | null, to: [number, number][] = []) {
    this.arcs = from && to.length ? { from, to } : null;
    this.request();
  }

  /** Mark a place as tuned without moving the map (the next move re-tunes). */
  setTuned(index: number | null) {
    this.tuned = index;
    this.request();
  }

  flyTo(lon: number, lat: number, zoom = Math.max(this.zoom, this.mode === "3d" ? 1.6 : 2.2), duration = 900) {
    const from: [number, number] = [this.lon, this.lat];
    const to: [number, number] = [lon, lat];
    const z0 = this.zoom;
    const interp = geoInterpolate(from, to);
    const dlon = wrap(lon - this.lon);
    this.startAnim(duration, (t) => {
      const k = ease(t);
      if (this.mode === "3d") {
        const [x, y] = interp(k);
        this.lon = x;
        this.lat = y;
      } else {
        this.lon = wrap(from[0] + dlon * k);
        this.lat = from[1] + (to[1] - from[1]) * k;
      }
      this.zoom = z0 + (zoom - z0) * k;
      this.clampLat();
    });
  }

  zoomBy(factor: number) {
    const z0 = this.zoom;
    const z1 = clamp(z0 * factor, 1, MAX_ZOOM);
    this.startAnim(250, (t) => {
      this.zoom = z0 + (z1 - z0) * ease(t);
      this.clampLat();
    });
  }

  panBy(dx: number, dy: number) {
    this.stopAnim();
    this.pan(dx, dy);
    this.moved();
  }

  center(): [number, number] {
    return [this.lon, this.lat];
  }

  // ---- geometry ---------------------------------------------------------

  private projection(): GeoProjection {
    if (this.mode === "3d") {
      return geoOrthographic()
        .rotate([-this.lon, -this.lat])
        .scale(this.baseScale * this.zoom)
        .translate([this.w / 2, this.h / 2])
        .clipAngle(90)
        .precision(this.interacting ? 1 : 0.4);
    }
    return this.theme
      .projection2d()
      .rotate([-this.lon, 0])
      .center([0, this.lat])
      .scale(this.baseScale * this.zoom)
      .translate([this.w / 2, this.h / 2])
      .precision(this.interacting ? 1 : 0.4);
  }

  private fit() {
    if (!this.w || !this.h) return;
    if (this.mode === "3d") {
      this.baseScale = Math.min(this.w, this.h) * 0.43;
    } else {
      const p = this.theme.projection2d().fitExtent(
        [
          [12, 12],
          [this.w - 12, this.h - 12],
        ],
        SPHERE,
      );
      this.baseScale = p.scale();
    }
    this.clampLat();
  }

  private clampLat() {
    if (this.mode === "3d") {
      this.lat = clamp(this.lat, -80, 80);
    } else {
      const k = this.baseScale * this.zoom;
      const halfDeg = (this.h / 2 / k) * DEG;
      const max = Math.max(0, 84 - halfDeg);
      this.lat = clamp(this.lat, -max, max);
    }
  }

  private visible(lon: number, lat: number): boolean {
    if (this.mode === "2d") return true;
    return geoDistance([lon, lat], [this.lon, this.lat]) < Math.PI / 2 - 0.03;
  }

  private resize() {
    const rect = this.container.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.patterns.clear();
    this.fit();
    this.request();
  }

  // ---- input ------------------------------------------------------------

  private pan(dx: number, dy: number) {
    const k = this.baseScale * this.zoom;
    this.lon = wrap(this.lon - (dx / k) * DEG);
    this.lat = this.lat + (dy / k) * DEG;
    this.clampLat();
  }

  private bindInput() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.stopAnim();
      this.interacting = true;
      if (this.pointers.size === 1) {
        this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
        this.velocity = { x: 0, y: 0, t: performance.now() };
      } else if (this.pointers.size === 2) {
        this.pinch = { dist: this.pointerDist(), zoom: this.zoom };
        this.down = null;
      }
    });
    c.addEventListener("pointermove", (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      this.pointers.set(e.pointerId, cur);
      if (this.pointers.size === 2 && this.pinch) {
        this.zoom = clamp((this.pinch.zoom * this.pointerDist()) / this.pinch.dist, 1, MAX_ZOOM);
        this.clampLat();
      } else if (this.pointers.size === 1) {
        const dx = cur.x - prev.x;
        const dy = cur.y - prev.y;
        this.pan(dx, dy);
        const now = performance.now();
        const dt = Math.max(1, now - this.velocity.t);
        this.velocity = { x: dx / dt, y: dy / dt, t: now };
      }
      this.moved();
    });
    const end = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 1) this.pinch = null;
      if (this.pointers.size > 0) return;
      const d = this.down;
      this.down = null;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5 && performance.now() - d.t < 500) {
        this.interacting = false;
        this.click(e);
        return;
      }
      const recent = performance.now() - this.velocity.t < 80;
      if (recent && Math.hypot(this.velocity.x, this.velocity.y) > 0.15) this.glide();
      else {
        this.interacting = false;
        this.moved();
      }
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.stopAnim();
        this.zoom = clamp(this.zoom * Math.exp(-e.deltaY * 0.0016), 1, MAX_ZOOM);
        this.clampLat();
        this.interacting = true;
        this.moved();
        clearTimeout(this.wheelTimer);
        this.wheelTimer = window.setTimeout(() => {
          this.interacting = false;
          this.request();
        }, 180);
      },
      { passive: false },
    );
    c.addEventListener("dblclick", () => this.zoomBy(2));
    c.addEventListener("keydown", (e) => {
      const step = 40;
      const keys: Record<string, () => void> = {
        ArrowLeft: () => this.panBy(step, 0),
        ArrowRight: () => this.panBy(-step, 0),
        ArrowUp: () => this.panBy(0, step),
        ArrowDown: () => this.panBy(0, -step),
        "+": () => this.zoomBy(1.5),
        "=": () => this.zoomBy(1.5),
        "-": () => this.zoomBy(1 / 1.5),
      };
      const fn = keys[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    });
  }

  private wheelTimer = 0;

  private pointerDist() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  private click(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best: (typeof this.screen)[number] | null = null;
    let bestD = Infinity;
    for (const s of this.screen) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < Math.max(14, s.r + 6) && d < bestD) {
        best = s;
        bestD = d;
      }
    }
    if (!best) return;
    const dot = this.dots.find((d) => d.index === best!.index);
    if (dot) this.flyTo(dot.lon, dot.lat);
  }

  private glide() {
    let { x: vx, y: vy } = this.velocity;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      this.pan(vx * dt, vy * dt);
      const decay = Math.pow(0.93, dt / 16);
      vx *= decay;
      vy *= decay;
      this.moved();
      if (Math.hypot(vx, vy) > 0.02 && this.pointers.size === 0) {
        this.frame = requestAnimationFrame(tick);
      } else {
        this.interacting = false;
        this.moved();
      }
    };
    this.frame = requestAnimationFrame(tick);
  }

  private startAnim(duration: number, step: (t: number) => void) {
    this.stopAnim();
    this.interacting = true;
    this.anim = { start: performance.now(), duration, step };
    const tick = (now: number) => {
      const a = this.anim;
      if (!a) return;
      const t = Math.min(1, (now - a.start) / a.duration);
      a.step(t);
      if (t < 1) {
        this.moved();
        this.frame = requestAnimationFrame(tick);
      } else {
        this.anim = null;
        this.interacting = false;
        this.moved();
      }
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stopAnim() {
    cancelAnimationFrame(this.frame);
    this.anim = null;
  }

  private moved() {
    this.request();
    this.events.onMove?.();
  }

  // ---- drawing ----------------------------------------------------------

  private pending = false;
  request() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
      this.retune();
    });
  }

  private retune() {
    const cx = this.w / 2;
    const cy = this.h / 2;
    let best: number | null = null;
    let bestD = TUNE_RADIUS;
    for (const s of this.screen) {
      const d = Math.hypot(s.x - cx, s.y - cy) - s.r * 0.5;
      if (d < bestD) {
        best = s.index;
        bestD = d;
      }
    }
    if (best !== this.tuned) {
      this.tuned = best;
      this.events.onTune(best);
      this.request();
    }
  }

  private pattern(kind: "halftone" | "matrix" | "hatch", ink: string): CanvasPattern {
    const key = `${kind}:${ink}:${this.dpr}`;
    let p = this.patterns.get(key);
    if (p) return p;
    const size = kind === "halftone" ? 5 : kind === "matrix" ? 4 : 6;
    const pc = document.createElement("canvas");
    pc.width = pc.height = Math.round(size * this.dpr);
    const g = pc.getContext("2d")!;
    g.scale(this.dpr, this.dpr);
    g.fillStyle = ink;
    g.strokeStyle = ink;
    if (kind === "halftone") {
      // Two offset dots per cell gives the 45-degree screen of newsprint.
      for (const [x, y] of [
        [1.25, 1.25],
        [3.75, 3.75],
      ]) {
        g.beginPath();
        g.arc(x, y, 0.95, 0, Math.PI * 2);
        g.fill();
      }
    } else if (kind === "matrix") {
      g.fillRect(1.5, 1.5, 1, 1);
    } else {
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(0, size);
      g.lineTo(size, 0);
      g.stroke();
    }
    p = this.ctx.createPattern(pc, "repeat")!;
    p.setTransform(new DOMMatrix().scale(1 / this.dpr));
    this.patterns.set(key, p);
    return p;
  }

  private render() {
    const { ctx, w, h, theme: t } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const proj = this.projection();
    const path = geoPath(proj, ctx);
    const map = this.interacting && this.low ? this.low : (this.high ?? this.low);
    const R = proj.scale();

    if (this.mode === "3d" && t.atmosphere) {
      const g = ctx.createRadialGradient(w / 2, h / 2, R * 0.98, w / 2, h / 2, R * 1.18);
      g.addColorStop(0, t.atmosphere);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.beginPath();
    path(SPHERE);
    ctx.fillStyle = t.ocean;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    path(SPHERE);
    ctx.clip();

    if (t.oceanHatch) {
      ctx.strokeStyle = t.oceanHatch;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let y = 0; y < h; y += 4) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
      }
      ctx.stroke();
    }

    ctx.beginPath();
    path(GRATICULE);
    ctx.strokeStyle = t.graticule;
    ctx.lineWidth = 0.6;
    ctx.setLineDash(t.graticuleDash);
    ctx.stroke();
    ctx.setLineDash([]);

    if (map) this.drawMap(path, proj, map, t);
    ctx.restore();

    // Globe rim / sheet edge
    ctx.beginPath();
    path(SPHERE);
    ctx.strokeStyle = t.coast;
    ctx.lineWidth = this.mode === "3d" ? 1 : 1.2;
    ctx.stroke();

    this.drawArcs(path, proj);
    this.drawDots(proj);
  }

  private drawMap(path: ReturnType<typeof geoPath>, proj: GeoProjection, map: Basemap, t: Theme) {
    const { ctx } = this;
    const lines = this.interacting ? Math.min(2, t.waterlines) : t.waterlines;
    if (lines > 0) {
      ctx.lineJoin = "round";
      const gap = 3.2;
      for (let i = lines; i >= 1; i--) {
        ctx.beginPath();
        path(map.land);
        ctx.lineWidth = i * gap * 2;
        ctx.strokeStyle = t.waterline;
        ctx.stroke();
        ctx.lineWidth = i * gap * 2 - 1.3;
        ctx.strokeStyle = t.ocean;
        ctx.stroke();
      }
    }

    ctx.beginPath();
    path(map.land);
    ctx.fillStyle = t.land;
    ctx.fill();
    if (t.landTexture !== "none") {
      ctx.fillStyle = this.pattern(t.landTexture, t.textureInk);
      ctx.fill();
    }

    if (map.ice) {
      ctx.beginPath();
      path(map.ice);
      ctx.fillStyle = t.ice;
      ctx.fill();
      if (!this.interacting) {
        ctx.fillStyle = this.pattern("hatch", t.relief);
        ctx.globalAlpha = 0.5;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    if (this.relief) this.drawRelief(proj, t);

    ctx.beginPath();
    path(map.lakes);
    ctx.fillStyle = t.lake;
    ctx.fill();
    ctx.strokeStyle = t.coast;
    ctx.lineWidth = 0.5;
    ctx.stroke();

    const maxRank = this.zoom < 1.8 ? 4 : this.zoom < 3.5 ? 5 : 9;
    ctx.beginPath();
    for (const f of map.rivers.features) if ((f.properties?.r ?? 9) <= maxRank) path(f);
    ctx.strokeStyle = t.river;
    ctx.lineWidth = 0.7;
    ctx.stroke();

    ctx.beginPath();
    path(map.land);
    ctx.strokeStyle = t.coast;
    ctx.lineWidth = t.coastWidth;
    ctx.stroke();
  }

  private drawRelief(proj: GeoProjection, t: Theme) {
    const { ctx } = this;
    const relief = this.relief!;
    const s = clamp(1.6 + this.zoom * 0.55, 2, 6);
    ctx.strokeStyle = t.relief;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (const [lon, lat] of relief.peaks) {
      if (!this.visible(lon, lat)) continue;
      const p = proj([lon, lat]);
      if (!p) continue;
      const [x, y] = p;
      if (x < -10 || y < -10 || x > this.w + 10 || y > this.h + 10) continue;
      // A small engraved peak: two strokes, the right flank shaded.
      ctx.moveTo(x - s, y + s * 0.55);
      ctx.lineTo(x, y - s * 0.75);
      ctx.lineTo(x + s, y + s * 0.55);
      ctx.moveTo(x + s * 0.15, y - s * 0.35);
      ctx.lineTo(x + s * 0.55, y + s * 0.5);
    }
    ctx.stroke();
    ctx.fillStyle = t.relief;
    for (const [lon, lat] of relief.dunes) {
      if (!this.visible(lon, lat)) continue;
      const p = proj([lon, lat]);
      if (!p) continue;
      ctx.fillRect(p[0], p[1], 1, 1);
      ctx.fillRect(p[0] + s * 0.8, p[1] + s * 0.4, 1, 1);
    }
  }

  private drawArcs(path: ReturnType<typeof geoPath>, proj: GeoProjection) {
    if (!this.arcs) return;
    const { ctx, theme: t } = this;
    ctx.save();
    ctx.strokeStyle = t.arc;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (const to of this.arcs.to) path({ type: "LineString", coordinates: [this.arcs.from, to] });
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [lon, lat] of this.arcs.to) {
      if (!this.visible(lon, lat)) continue;
      const p = proj([lon, lat]);
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawDots(proj: GeoProjection) {
    const { ctx, theme: t } = this;
    this.screen = [];
    // Smaller screens get smaller dots so a phone-sized world isn't all ink.
    const screenK = clamp(Math.min(this.w, this.h) / 720, 0.6, 1);
    const zoomK = (0.85 + 0.15 * Math.min(this.zoom, 4)) * screenK;
    let tunedAt: { x: number; y: number; r: number } | null = null;
    ctx.save();
    if (t.glow) {
      ctx.shadowBlur = 8;
    }
    for (const d of this.dots) {
      if (!this.visible(d.lon, d.lat)) continue;
      const p = proj([d.lon, d.lat]);
      if (!p) continue;
      const [x, y] = p;
      if (x < -20 || y < -20 || x > this.w + 20 || y > this.h + 20) continue;
      const r = Math.min(10, 2.2 + Math.sqrt(d.count) * 1.25) * zoomK;
      this.screen.push({ index: d.index, x, y, r });
      if (t.glow) ctx.shadowColor = d.fresh ? t.fresh : t.dot;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = d.fresh ? t.fresh : t.dot;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = t.dotStroke;
      ctx.stroke();
      if (d.fresh && t.fresh === t.dot) {
        // Monochrome themes mark fresh reports with an outer ring instead of colour.
        ctx.beginPath();
        ctx.arc(x, y, r + 2.6, 0, Math.PI * 2);
        ctx.lineWidth = 0.9;
        ctx.strokeStyle = t.dot;
        ctx.stroke();
      }
      if (this.pinned.has(d.index)) {
        ctx.beginPath();
        ctx.rect(x - r - 3.5, y - r - 3.5, (r + 3.5) * 2, (r + 3.5) * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = t.tuned;
        ctx.stroke();
      }
      if (this.highlight.has(d.index)) {
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(x, y, r + 6, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = t.arc;
        ctx.stroke();
        ctx.restore();
      }
      if (d.index === this.tuned) tunedAt = { x, y, r };
    }
    ctx.restore();
    if (tunedAt) {
      const { x, y, r } = tunedAt;
      ctx.beginPath();
      ctx.arc(x, y, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = t.tuned;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }
}
