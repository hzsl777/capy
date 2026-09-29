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
import { drawDecor } from "./decor.ts";
import { buildTerrain, type Terrain } from "./terrain.ts";

export interface Dot {
  /** Index into NewsFile.places. */
  index: number;
  lon: number;
  lat: number;
  count: number;
  /** The place's most important story, 1 to 5. With the report count, it sets the dot's size (decision 46). */
  weight: number;
  fresh: boolean;
  /**
   * The lowest zoom level at which this place shows, 0 (the whole world) to TIERS - 1 (decisions 30 and 46).
   * Never changes a dot's colour.
   */
  tier: number;
}

export interface MapEvents {
  /**
   * The places under the reticle changed (null when nothing is in reach). More than one when nearby pins
   * are merged at this zoom.
   */
  onTune(indices: number[] | null): void;
  /** Any change of position, zoom or mode. */
  onMove?(): void;
  /** The zoom level (0 to 2) changed, so a different set of places is shown. */
  onLevel?(level: number): void;
  /** The idle spin landed on a place and stopped. */
  onLand?(): void;
  /** The person touched the map: the spin stops and the idle timer restarts. */
  onInteract?(): void;
}

/** One drawn dot: a single place, or nearby places merged at this zoom. */
interface Spot {
  indices: number[];
  lon: number;
  lat: number;
  x: number;
  y: number;
  r: number;
  count: number;
  weight: number;
  fresh: boolean;
}

const SPHERE: GeoPermissibleObjects = { type: "Sphere" };
const GRATICULE = geoGraticule().step([15, 15])();

type PatternKind = "halftone" | "matrix" | "dither" | "hatch" | "blocks" | "grass" | "brush" | "mottle" | "tiles" | "shimmer";

const DEG = 180 / Math.PI;
const TUNE_RADIUS = 22;
const MAX_ZOOM = 14;
/** Screen distance under which pins merge into one dot. */
const MERGE_PX = 13;
/** d3 draws into anything canvas-like; a Path2D only lacks beginPath, which a fresh path doesn't need. */
function pathContext(p: Path2D) {
  return { beginPath() {}, moveTo: p.moveTo.bind(p), lineTo: p.lineTo.bind(p), arc: p.arc.bind(p), closePath: p.closePath.bind(p) };
}

/** Pixels drawn beyond the frame on the flat map: more than the widest coast ripple line. */
const CLIP_MARGIN = 48;

/** Projection scale (about the globe's radius in pixels) from which the detailed basemap is drawn. */
const DETAIL_SCALE = 520;

/** Resampling precision in pixels. One value for every frame, so outlines never shift between frames. */
const PRECISION = 0.5;

/** Degrees per second for the idle spin. */
const SPIN_SPEED = 7;
/** The spin turns at least this long before it may land, so it reads as a spin. */
const SPIN_MIN_MS = 2500;
const key = (indices: number[]) => indices.join(",");

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
  private terrain?: { base: Basemap; relief?: Relief; mesh: Terrain };
  private dots: Dot[] = [];
  private screen: Spot[] = [];
  private tuned: number[] | null = null;
  private lastLevel = -1;
  private spinning = false;
  private spinFrame = 0;
  /** The spot under the reticle when the spin started, so it doesn't land where it began. */
  private spinSkip: string | null = null;
  private spinStarted = 0;
  private pinned = new Set<number>();
  private arcs: { from: [number, number]; to: [number, number][] } | null = null;
  /** Places tied to what the panel shows (the telegram's events, or one event). Drawn with a dashed ring. */
  private highlight = new Set<number>();

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
    const resample = theme.pixel !== this.theme.pixel;
    this.theme = theme;
    this.patterns.clear();
    if (resample) this.resize();
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

  /** Mark places as tuned without moving the map (the next move re-tunes). */
  setTuned(indices: number[] | null) {
    this.tuned = indices;
    this.request();
  }

  /** Which set of places shows at the current zoom: 0 (widely reported or important only) to 2 (all). */
  level(): number {
    // Each step in reveals the next tier (decision 46). The flat map starts already filling its frame (fit()),
    // so it needs less zoom than the globe per level.
    const steps = this.mode === "3d" ? [1.6, 2.4, 3.4, 4.8] : [1.4, 2.1, 3, 4.2];
    const i = steps.findIndex((s) => this.zoom < s);
    return i < 0 ? steps.length : i;
  }

  get isSpinning(): boolean {
    return this.spinning;
  }

  /** Turn the map slowly until a place passes under the reticle, then stop there. */
  startSpin() {
    if (this.spinning) return;
    this.stopAnim();
    this.spinning = true;
    this.spinStarted = performance.now();
    this.spinSkip = this.tuned ? key(this.tuned) : null;
    let last = performance.now();
    const tick = (now: number) => {
      if (!this.spinning) return;
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      this.lon = wrap(this.lon + SPIN_SPEED * dt);
      this.request();
      this.spinFrame = requestAnimationFrame(tick);
    };
    this.spinFrame = requestAnimationFrame(tick);
  }

  stopSpin() {
    if (!this.spinning) return;
    this.spinning = false;
    cancelAnimationFrame(this.spinFrame);
    this.request();
  }

  flyTo(lon: number, lat: number, zoom = Math.max(this.zoom, this.mode === "3d" ? 1.6 : 1.4), duration = 900) {
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
    this.touched();
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

  /** Jump without animating, e.g. to a random longitude before the first spin. */
  setCenter(lon: number, lat: number) {
    this.lon = wrap(lon);
    this.lat = lat;
    this.clampLat();
    this.request();
  }

  // ---- geometry ---------------------------------------------------------

  private projection(): GeoProjection {
    if (this.mode === "3d") {
      return geoOrthographic()
        .rotate([-this.lon, -this.lat])
        .scale(this.baseScale * this.zoom)
        .translate([this.w / 2, this.h / 2])
        .clipAngle(90)
        .clipExtent([
          [-CLIP_MARGIN, -CLIP_MARGIN],
          [this.w + CLIP_MARGIN, this.h + CLIP_MARGIN],
        ])
        .precision(PRECISION);
    }
    return this.theme
      .projection2d()
      .rotate([-this.lon, 0])
      .center([0, this.lat])
      .scale(this.baseScale * this.zoom)
      .translate([this.w / 2, this.h / 2])
      // Only what is on screen, plus room for the widest coast ripple, is resampled and drawn. Zoomed in, that
      // is a small part of the world.
      .clipExtent([
        [-CLIP_MARGIN, -CLIP_MARGIN],
        [this.w + CLIP_MARGIN, this.h + CLIP_MARGIN],
      ])
      .precision(PRECISION);
  }

  private fit() {
    if (!this.w || !this.h) return;
    if (this.mode === "3d") {
      this.baseScale = Math.min(this.w, this.h) * 0.46;
    } else {
      // Cover the frame rather than fit inside it: the world fills the height (or the width, in a tall frame),
      // and longitude wraps as you drag, so nothing is lost off the sides.
      const p = this.theme.projection2d().fitExtent(
        [
          [0, 0],
          [this.w, this.h],
        ],
        SPHERE,
      );
      const [[x0, y0], [x1, y1]] = geoPath(p).bounds(SPHERE);
      this.baseScale = p.scale() * Math.max(this.w / (x1 - x0), this.h / (y1 - y0));
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
    // A pixel design draws fewer canvas pixels than the screen has and lets the browser enlarge them unsmoothed.
    const pixel = this.theme.pixel;
    this.dpr = pixel > 1 ? 1 / pixel : Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.style.imageRendering = pixel > 1 && !this.theme.smooth ? "pixelated" : "auto";
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
      this.touched();
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.stopAnim();
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
        this.click(e);
        return;
      }
      const recent = performance.now() - this.velocity.t < 80;
      if (recent && Math.hypot(this.velocity.x, this.velocity.y) > 0.15) this.glide();
      else {
        this.moved();
      }
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.touched();
        this.stopAnim();
        this.zoom = clamp(this.zoom * Math.exp(-e.deltaY * 0.0016), 1, MAX_ZOOM);
        this.clampLat();
        this.moved();
        clearTimeout(this.wheelTimer);
        this.wheelTimer = window.setTimeout(() => {
          this.request();
        }, 180);
      },
      { passive: false },
    );
    c.addEventListener("dblclick", () => this.zoomBy(2));
    c.addEventListener("keydown", (e) => {
      this.touched();
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

  private touched() {
    this.stopSpin();
    this.events.onInteract?.();
  }

  private pointerDist() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  private click(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best: Spot | null = null;
    let bestD = Infinity;
    for (const s of this.screen) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < Math.max(14, s.r + 6) && d < bestD) {
        best = s;
        bestD = d;
      }
    }
    if (!best) return;
    // A merged dot opens up: zoom in far enough to separate its places.
    this.flyTo(best.lon, best.lat, best.indices.length > 1 ? Math.min(MAX_ZOOM, this.zoom * 2.2) : undefined);
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
        this.moved();
      }
    };
    this.frame = requestAnimationFrame(tick);
  }

  private startAnim(duration: number, step: (t: number) => void) {
    this.stopAnim();
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
    const level = this.level();
    if (level !== this.lastLevel) {
      this.lastLevel = level;
      this.events.onLevel?.(level);
    }
    const cx = this.w / 2;
    const cy = this.h / 2;
    let best: Spot | null = null;
    let bestD = TUNE_RADIUS;
    for (const s of this.screen) {
      const d = Math.hypot(s.x - cx, s.y - cy) - s.r * 0.5;
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    const next = best ? best.indices : null;
    const nextKey = next ? key(next) : null;
    if (this.spinning) {
      if (nextKey === null) this.spinSkip = null;
      else if (nextKey !== this.spinSkip && best && performance.now() - this.spinStarted > SPIN_MIN_MS) {
        // Landed: stop and settle the dot under the reticle.
        this.stopSpin();
        this.flyTo(best.lon, best.lat, this.zoom, 500);
        this.events.onLand?.();
      }
    }
    if (nextKey !== (this.tuned ? key(this.tuned) : null)) {
      this.tuned = next;
      this.events.onTune(next);
      this.request();
    }
  }

  private pattern(kind: PatternKind, ink: string, ink2 = ink): CanvasPattern {
    const key = `${kind}:${ink}:${ink2}:${this.dpr}`;
    let p = this.patterns.get(key);
    if (p) return p;
    if (kind === "dither" || kind === "tiles" || kind === "shimmer" || kind === "blocks" || kind === "grass") {
      // Drawn in canvas pixels, so they stay crisp and blocky in the pixel designs: a checkerboard dither, a grid of
      // 8-pixel tiles, broken glints on water, bevelled blocks (light top and left edges, dark bottom and right,
      // one rivet), or tufts of grass in two shades.
      const dc = document.createElement("canvas");
      const n = kind === "dither" ? 2 : kind === "shimmer" ? 12 : 8;
      dc.width = dc.height = n;
      const dg = dc.getContext("2d")!;
      const dot = (c: string, cells: number[][]) => {
        dg.fillStyle = c;
        for (const [x, y, w = 1, hh = 1] of cells) dg.fillRect(x!, y!, w, hh);
      };
      if (kind === "dither") dot(ink, [[0, 0], [1, 1]]);
      else if (kind === "tiles") dot(ink, [[0, 0, n, 1], [0, 0, 1, n], [3, 3, 2, 2]]);
      else if (kind === "shimmer") dot(ink, [[1, 2, 3, 1], [7, 8, 2, 1]]);
      else if (kind === "blocks") {
        dot(ink2, [[0, 0, 7, 1], [0, 0, 1, 7], [2, 2]]);
        dot(ink, [[1, 7, 7, 1], [7, 1, 1, 7], [3, 3]]);
      } else {
        dot(ink, [[1, 1], [2, 0], [5, 4], [6, 3], [3, 6]]);
        dot(ink2, [[4, 1], [0, 5], [7, 6], [2, 3]]);
      }
      p = this.ctx.createPattern(dc, "repeat")!;
      p.setTransform(new DOMMatrix().scale(1 / this.dpr));
      this.patterns.set(key, p);
      return p;
    }
    if (kind === "mottle") {
      // A blurry low-resolution texture: soft blobs of a lighter and a darker shade, drawn on a three-by-three sheet
      // and blurred there so the middle tile wraps without a seam.
      const size = 128;
      const big = document.createElement("canvas");
      big.width = big.height = Math.round(size * 3 * this.dpr);
      const g = big.getContext("2d")!;
      g.scale(this.dpr, this.dpr);
      let seed = 11;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const blobs = Array.from({ length: 70 }, (_, i) => ({ x: rnd() * size, y: rnd() * size, r: 2 + rnd() * rnd() * 11, a: rnd() * Math.PI, c: i % 2 ? ink2 : ink }));
      for (const ox of [0, size, 2 * size])
        for (const oy of [0, size, 2 * size])
          for (const b of blobs) {
            g.beginPath();
            g.ellipse(b.x + ox, b.y + oy, b.r * 1.4, b.r, b.a, 0, Math.PI * 2);
            g.fillStyle = b.c;
            g.fill();
          }
      const tile = document.createElement("canvas");
      tile.width = tile.height = Math.round(size * this.dpr);
      const tg = tile.getContext("2d")!;
      tg.filter = `blur(${2.5 * this.dpr}px)`;
      tg.drawImage(big, -size * this.dpr, -size * this.dpr);
      p = this.ctx.createPattern(tile, "repeat")!;
      p.setTransform(new DOMMatrix().scale(1 / this.dpr));
      this.patterns.set(key, p);
      return p;
    }
    if (kind === "brush") {
      // Loose paint: short thick strokes at fixed pseudo-random spots, each drawn again one tile over in every
      // direction so strokes cross the tile's edge without a seam.
      const size = 96;
      const pc = document.createElement("canvas");
      pc.width = pc.height = Math.round(size * this.dpr);
      const g = pc.getContext("2d")!;
      g.scale(this.dpr, this.dpr);
      g.lineCap = "round";
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 16; i++) {
        const x = rnd() * size, y = rnd() * size, a = -1.4 + rnd() * 1.8, len = 6 + rnd() * 14;
        g.strokeStyle = i % 2 ? ink2 : ink;
        g.lineWidth = 2.5 + rnd() * 3;
        for (const ox of [-size, 0, size])
          for (const oy of [-size, 0, size]) {
            g.beginPath();
            g.moveTo(x + ox, y + oy);
            g.quadraticCurveTo(x + ox + len * 0.5, y + oy + len * Math.sin(a) * 0.2 - 2, x + ox + len * Math.cos(a), y + oy + len * Math.sin(a));
            g.stroke();
          }
      }
      p = this.ctx.createPattern(pc, "repeat")!;
      p.setTransform(new DOMMatrix().scale(1 / this.dpr));
      this.patterns.set(key, p);
      return p;
    }
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
    // Detail follows the map's size on screen, never whether it is being dragged, so coasts, lakes and rivers
    // don't change shape when the map is touched or let go (decision 42). The whole world at once gets the light
    // file, where the finer one adds nothing visible and drags slowly; zooming in switches to the fine one.
    const map = (proj.scale() >= DETAIL_SCALE ? this.high : this.low) ?? this.low ?? this.high;
    const R = proj.scale();

    if (this.mode === "3d" && t.atmosphere) {
      const g = ctx.createRadialGradient(w / 2, h / 2, R * 0.98, w / 2, h / 2, R * 1.18);
      g.addColorStop(0, t.atmosphere);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // The sphere's outline: a circle, or for a low-poly design a polygon drawn just outside it, so the globe has
    // corners like a model built from flat faces.
    const outline = () => {
      ctx.beginPath();
      if (this.mode === "3d" && t.polyGlobe) {
        const [cx, cy] = proj.translate();
        const n = t.polyGlobe;
        const r = R / Math.cos(Math.PI / n);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          if (i === 0) ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
          else ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        ctx.closePath();
      } else path(SPHERE);
    };
    outline();
    ctx.fillStyle = t.ocean;
    ctx.fill();

    ctx.save();
    outline();
    ctx.clip();

    if (t.oceanPattern) {
      // Mottled water gets deeper patches as well as light ones.
      ctx.fillStyle = this.pattern(t.oceanPattern, t.waterline, t.oceanPattern === "mottle" ? "rgba(0,40,120,0.25)" : undefined);
      ctx.fillRect(0, 0, w, h);
    }
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

    if (map && t.lowPoly) this.drawLowPoly(proj, t);
    else if (map) this.drawMap(path, proj, map, t);
    if (this.mode === "3d" && t.shade) {
      // Lit from the upper left, darker toward the rim, so the globe reads as a solid.
      const g = ctx.createRadialGradient(w / 2 - R * 0.38, h / 2 - R * 0.42, R * 0.15, w / 2, h / 2, R * 1.02);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.55, "rgba(0,0,0,0)");
      g.addColorStop(1, t.shade);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.mode === "3d" && t.fog) {
      // Distance haze: the far side of the world fades toward the sky, as early 3D games hid their draw distance.
      const g = ctx.createRadialGradient(w / 2, h / 2, R * 0.55, w / 2, h / 2, R * 1.05);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, t.fog);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.mode === "3d" && t.specular) {
      // A soft glint where the light strikes the sphere.
      const g = ctx.createRadialGradient(w / 2 - R * 0.42, h / 2 - R * 0.46, 0, w / 2 - R * 0.42, h / 2 - R * 0.46, R * 0.55);
      g.addColorStop(0, "rgba(255,255,255,0.32)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();

    // Globe rim / sheet edge
    outline();
    ctx.strokeStyle = t.coast;
    ctx.lineWidth = this.mode === "3d" ? 1 : 1.2;
    ctx.stroke();
    if (this.mode === "2d" && t.neatline) {
      // A printed chart's double frame around the whole sheet.
      const [[x0, y0], [x1, y1]] = path.bounds(SPHERE);
      ctx.strokeStyle = t.coast;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x0 - 7, y0 - 7, x1 - x0 + 14, y1 - y0 + 14);
      ctx.lineWidth = 0.6;
      ctx.strokeRect(x0 - 11, y0 - 11, x1 - x0 + 22, y1 - y0 + 22);
    }

    drawDecor(ctx, proj, t, this.mode, [this.lon, this.lat]);
    this.drawArcs(path, proj);
    this.drawDots(proj);
  }

  private drawMap(path: ReturnType<typeof geoPath>, proj: GeoProjection, map: Basemap, t: Theme) {
    const { ctx } = this;
    // The coastline is projected once per frame and reused for every fill and stroke below. Projecting it again
    // for each ripple line cost more than the drawing itself.
    const land = new Path2D();
    geoPath(proj, pathContext(land))(map.land);
    const coast = new Path2D();
    geoPath(proj, pathContext(coast))(map.coast);
    const lines = t.waterlines;
    if (lines > 0) {
      ctx.lineJoin = "round";
      const gap = 3.2;
      for (let i = lines; i >= 1; i--) {
        ctx.lineWidth = i * gap * 2;
        ctx.strokeStyle = t.waterline;
        ctx.stroke(coast);
        ctx.lineWidth = i * gap * 2 - 1.3;
        ctx.strokeStyle = t.ocean;
        ctx.stroke(coast);
      }
    }

    if (t.shallows) {
      ctx.lineJoin = "round";
      ctx.lineWidth = 12;
      ctx.strokeStyle = t.shallows;
      ctx.stroke(coast);
    }

    ctx.fillStyle = t.land;
    ctx.fill(land);
    if (t.landTexture !== "none") {
      ctx.fillStyle = this.pattern(t.landTexture, t.textureInk, t.textureInk2);
      ctx.fill(land);
    }

    if (map.ice) {
      ctx.beginPath();
      path(map.ice);
      ctx.fillStyle = t.ice;
      ctx.fill();
      ctx.fillStyle = this.pattern("hatch", t.relief);
      ctx.globalAlpha = 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;
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

    ctx.strokeStyle = t.coast;
    ctx.lineWidth = t.coastWidth;
    ctx.stroke(coast);
  }

  /**
   * Terrain the way early 3D games built their overworlds: a grid of flat-shaded triangles with a height at every
   * corner, raised toward the viewer like a tilted camera, drawn back to front on cliff walls along the coast.
   */
  private drawLowPoly(proj: GeoProjection, t: Theme) {
    const { ctx, w, h: height } = this;
    const lp = t.lowPoly!;
    const base = this.low ?? this.high;
    if (!base) return;
    if (!this.terrain || this.terrain.base !== base || this.terrain.relief !== this.relief) {
      this.terrain = { base, relief: this.relief, mesh: buildTerrain(base, this.relief, lp.step) };
    }
    const m = this.terrain.mesh;
    const R = proj.scale();
    // Screen pixels per unit of height, growing with the map so mountains keep their shape when zoomed.
    const lift = R * 0.022;
    const flat = this.mode === "2d";
    const n = m.lon.length;
    const X = new Float32Array(n);
    const Y = new Float32Array(n);
    const seen = new Uint8Array(n);
    const project = (i: number) => {
      if (seen[i]) return seen[i] === 1;
      const lo = m.lon[i]!, la = m.lat[i]!;
      const p = this.visible(lo, la) ? proj([lo, la]) : null;
      if (!p) {
        seen[i] = 2;
        return false;
      }
      X[i] = p[0];
      Y[i] = p[1];
      seen[i] = 1;
      return true;
    };
    const tri = m.tris;
    const order: number[] = [];
    for (let k = 0; k < tri.length; k += 3) {
      const a = tri[k]!, b = tri[k + 1]!, c = tri[k + 2]!;
      if (!project(a) || !project(b) || !project(c)) continue;
      const minX = Math.min(X[a]!, X[b]!, X[c]!), maxX = Math.max(X[a]!, X[b]!, X[c]!);
      // A cell cut by the flat map's edge would stretch across the whole sheet.
      if (flat && maxX - minX > w / 3) continue;
      if (maxX < -40 || minX > w + 40) continue;
      const minY = Math.min(Y[a]!, Y[b]!, Y[c]!);
      if (minY > height + 40 || Math.max(Y[a]!, Y[b]!, Y[c]!) < -60) continue;
      order.push(k);
    }

    // Cliff walls first: each coast edge swept down. Walls under land are covered by the triangles drawn after.
    const depth = clamp(R * 0.02, 4, 16);
    const [cliff, cliffLight, cliffDark] = lp.cliff;
    const walls = new Path2D();
    const coast = m.coast;
    for (let k = 0; k < coast.length; k += 2) {
      const a = coast[k]!, b = coast[k + 1]!;
      if (!project(a) || !project(b)) continue;
      if (flat && Math.abs(X[a]! - X[b]!) > w / 3) continue;
      walls.moveTo(X[a]!, Y[a]!);
      walls.lineTo(X[b]!, Y[b]!);
      walls.lineTo(X[b]!, Y[b]! + depth);
      walls.lineTo(X[a]!, Y[a]! + depth);
      walls.closePath();
    }
    ctx.fillStyle = cliff;
    ctx.fill(walls);
    ctx.fillStyle = this.pattern("mottle", cliffLight, cliffDark);
    ctx.fill(walls);

    // Far first: the triangle whose ground sits higher on the screen is further away.
    order.sort((p, q) => Y[tri[p]!]! + Y[tri[p + 1]!]! + Y[tri[p + 2]!]! - (Y[tri[q]!]! + Y[tri[q + 1]!]! + Y[tri[q + 2]!]!));
    const H = m.h;
    const [gr, gg, gb] = lp.grass;
    const [rr, rg, rb] = lp.rock;
    // Light from the upper left and above.
    const LX = -0.45, LY = -0.55, LZ = 0.7;
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.6;
    for (const k of order) {
      const a = tri[k]!, b = tri[k + 1]!, c = tri[k + 2]!;
      const ha = H[a]! * lift, hb = H[b]! * lift, hc = H[c]! * lift;
      const ax = X[a]!, ay = Y[a]! - ha, bx = X[b]!, by = Y[b]! - hb, cx = X[c]!, cy = Y[c]! - hc;
      // The face's normal from its corners on the ground and their heights.
      const ux = X[b]! - ax, uy = Y[b]! - Y[a]!, uz = hb - ha;
      const vx = X[c]! - ax, vy = Y[c]! - Y[a]!, vz = hc - ha;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nz < 0) (nx = -nx), (ny = -ny), (nz = -nz);
      const len = Math.hypot(nx, ny, nz) || 1;
      const light = Math.max(0.35, (nx * LX + ny * LY + nz * LZ) / len) * 1.25;
      const top = Math.max(H[a]!, H[b]!, H[c]!);
      let r: number, g: number, bl: number;
      if (m.ice[k / 3] || top > 4.2) (r = 236), (g = 242), (bl = 252);
      else if (top > 1.6) (r = rr), (g = rg), (bl = rb);
      else (r = gr), (g = gg), (bl = gb);
      const col = `rgb(${Math.min(255, r * light) | 0},${Math.min(255, g * light) | 0},${Math.min(255, bl * light) | 0})`;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(cx, cy);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.strokeStyle = col;
      ctx.fill();
      // The same colour along the edges closes the hairline gaps between neighbours.
      ctx.stroke();
    }
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
    // Smaller screens get smaller dots so a phone-sized world isn't all ink.
    const screenK = clamp(Math.min(this.w, this.h) / 720, 0.6, 1);
    const zoomK = (0.85 + 0.15 * Math.min(this.zoom, 4)) * screenK;
    const level = this.level();

    // Project the places shown at this zoom, then merge those that would overlap on screen.
    // Largest first, so a merged dot sits on its busiest place.
    const shown: { d: Dot; x: number; y: number }[] = [];
    for (const d of this.dots) {
      if (d.tier > level || !this.visible(d.lon, d.lat)) continue;
      const p = proj([d.lon, d.lat]);
      if (!p) continue;
      if (p[0] < -20 || p[1] < -20 || p[0] > this.w + 20 || p[1] > this.h + 20) continue;
      shown.push({ d, x: p[0], y: p[1] });
    }
    shown.sort((a, b) => b.d.weight - a.d.weight || b.d.count - a.d.count);
    const spots: Spot[] = [];
    const merge = MERGE_PX * screenK;
    for (const { d, x, y } of shown) {
      const near = spots.find((s) => Math.hypot(s.x - x, s.y - y) < merge);
      if (near) {
        near.indices.push(d.index);
        near.count += d.count;
        near.weight = Math.max(near.weight, d.weight);
        near.fresh ||= d.fresh;
      } else {
        spots.push({ indices: [d.index], lon: d.lon, lat: d.lat, x, y, r: 0, count: d.count, weight: d.weight, fresh: d.fresh });
      }
    }
    // Size follows the place's most important story and its number of reports (decision 46), so one major
    // story reads as larger than a busy city of minor ones. Colour still means only "reported in the last hour".
    for (const s of spots) {
      s.indices.sort((a, b) => a - b);
      s.r = Math.min(13, 1.4 + s.weight * 0.9 + Math.sqrt(s.count) * 0.8) * zoomK;
    }
    this.screen = spots;

    const tunedKey = this.tuned ? key(this.tuned) : null;
    let tunedAt: Spot | null = null;
    ctx.save();
    if (t.glow) ctx.shadowBlur = 8;
    // A circle, or a square snapped to whole canvas pixels for the pixel designs.
    const shape = (x: number, y: number, r: number) => {
      if (t.dotShape === "square") ctx.rect(Math.round(x - r), Math.round(y - r), Math.round(r * 2), Math.round(r * 2));
      else if (t.dotShape === "diamond") {
        const d = r * 1.3;
        ctx.moveTo(x, y - d);
        ctx.lineTo(x + d, y);
        ctx.lineTo(x, y + d);
        ctx.lineTo(x - d, y);
        ctx.closePath();
      } else ctx.arc(x, y, r, 0, Math.PI * 2);
    };
    // Three symbols by the place's most important story (decision 57), drawn least important first so the most
    // important always sit on top: hollow for importance 1 and GDELT local stories, filled for 2 and 3, filled
    // with an outer ring for 4 and 5. Colour still means only "reported in the last hour".
    for (const s of [...spots].reverse()) {
      const { x, y, r } = s;
      const ink = s.fresh ? t.fresh : t.dot;
      const hollow = s.weight <= 1;
      if (t.glow) ctx.shadowColor = ink;
      ctx.beginPath();
      shape(x, y, r);
      ctx.fillStyle = hollow ? t.dotStroke : ink;
      ctx.fill();
      if (t.dotShape === "coin" && !hollow) {
        // A coin: a darker rim, a slot down the middle and a glint at the upper left.
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(1, r * 0.18);
        ctx.strokeStyle = "rgba(0,0,0,0.22)";
        ctx.stroke();
        ctx.fillStyle = t.dotStroke;
        ctx.fillRect(x - r * 0.13, y - r * 0.45, r * 0.26, r * 0.9);
        ctx.beginPath();
        ctx.arc(x - r * 0.35, y - r * 0.4, r * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fill();
        ctx.restore();
        ctx.beginPath();
        shape(x, y, r);
      }
      if (t.dotShape === "diamond" && !hollow) {
        // Cut like a gem: the right half in shadow and a glint on the upper left facet.
        const d = r * 1.3;
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(x, y - d);
        ctx.lineTo(x + d, y);
        ctx.lineTo(x, y + d);
        ctx.closePath();
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x, y - d);
        ctx.lineTo(x - d * 0.5, y - d * 0.5);
        ctx.lineTo(x, y - d * 0.2);
        ctx.closePath();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fill();
        ctx.restore();
        ctx.beginPath();
        shape(x, y, r);
      }
      ctx.lineWidth = hollow ? 1.6 : 1.2;
      ctx.strokeStyle = hollow ? ink : t.dotStroke;
      ctx.stroke();
      const ring = s.weight >= 4 ? r + 2.6 : r;
      if (s.weight >= 4) {
        ctx.beginPath();
        shape(x, y, ring);
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = ink;
        ctx.stroke();
      }
      if (s.indices.length > 1) {
        // Merged places: a thin inner ring, so a cluster reads differently from one busy city.
        ctx.beginPath();
        shape(x, y, Math.max(1.2, r * 0.45));
        ctx.lineWidth = 1;
        ctx.strokeStyle = hollow ? ink : t.dotStroke;
        ctx.stroke();
      }
      if (s.fresh && t.fresh === t.dot) {
        // Monochrome designs mark fresh reports with a dashed ring, so it never reads as the importance ring.
        ctx.save();
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        shape(x, y, ring + 2.6);
        ctx.lineWidth = 0.9;
        ctx.strokeStyle = t.dot;
        ctx.stroke();
        ctx.restore();
      }
      if (s.indices.some((i) => this.pinned.has(i))) {
        ctx.beginPath();
        ctx.rect(x - r - 3.5, y - r - 3.5, (r + 3.5) * 2, (r + 3.5) * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = t.tuned;
        ctx.stroke();
      }
      if (s.indices.some((i) => this.highlight.has(i))) {
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
      if (tunedKey !== null && key(s.indices) === tunedKey) tunedAt = s;
    }
    ctx.restore();
    if (tunedAt) {
      const { x, y, r } = tunedAt;
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = t.tuned;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}
