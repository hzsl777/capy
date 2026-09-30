import {
  geoDistance,
  geoEquirectangular,
  geoGraticule,
  geoInterpolate,
  geoOrthographic,
  geoPath,
  type GeoPermissibleObjects,
  type GeoProjection,
  type GeoStream,
} from "d3-geo";
import type { Theme, ViewMode } from "../themes.ts";
import type { Basemap, Relief } from "./basemap.ts";
import { drawDecor } from "./decor.ts";
import { markPath2D } from "./marks.ts";
import { drawScenery, drawSceneryUnder, type SceneryFrame } from "./scenery.ts";
import { buildTerrain, heightAt, type Terrain } from "./terrain.ts";
import { drawNeon, NeonCache } from "./neon.ts";
import { drawStitch, StitchCache } from "./stitch.ts";
import { drawGlass, GlassCache } from "./glass.ts";
import type { SurfaceFrame } from "./surface.ts";

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
  /** Where the place meets the ground, when the marker floats above raised terrain. Tuning uses this point. */
  gx?: number;
  gy?: number;
}

/** A tilted camera over the flat map: the frame's centre stays put, the far side shrinks toward a horizon. */
interface Cam {
  cx: number;
  cy: number;
  sin: number;
  cos: number;
  /** Distance from the eye to the picture, in pixels. Smaller means stronger perspective. */
  d: number;
  /** The draw distance: nothing is drawn where the camera's scale falls below this. */
  far: number;
}

/** Grid spacing for Polygon Kingdom's terrain by zoom: coarse at the whole world, finer as you zoom in. */
const TERRAIN_STEPS: [number, number][] = [
  [1.8, 3],
  [4, 1.5],
  [Infinity, 0.75],
];

/** Which half-degree cells a layer covers, read back from drawing it once on a small plate carrée canvas. */
function raster(fc: Basemap["land"] | undefined): (lon: number, lat: number) => boolean {
  const W = 720;
  const H = 360;
  if (!fc) return () => false;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  const proj = geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]).precision(0.2);
  g.beginPath();
  geoPath(proj, g)(fc);
  g.fillStyle = "#fff";
  g.fill();
  const px = g.getImageData(0, 0, W, H).data;
  return (lon, lat) => {
    const x = Math.min(W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
    return px[(y * W + x) * 4 + 3]! > 127;
  };
}

const unitOf = (lon: number, lat: number): [number, number, number] => {
  const l = lon / DEG, p = lat / DEG;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
};

/** Mix a packed 0xRRGGBB colour toward a CSS hex colour by t, as a CSS string. */
function fogged(rgb: number, fog: [number, number, number], t: number): string {
  const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
  return `rgb(${Math.round(r + (fog[0] - r) * t)},${Math.round(g + (fog[1] - g) * t)},${Math.round(b + (fog[2] - b) * t)})`;
}

const hexRgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

const SPHERE: GeoPermissibleObjects = { type: "Sphere" };
const GRATICULE = geoGraticule().step([15, 15])();

type PatternKind = "halftone" | "matrix" | "dither" | "hatch" | "blocks" | "grass" | "brush" | "mottle" | "honeycomb" | "tiles" | "shimmer";

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
  private cam: Cam | null = null;
  private rasters?: { base: Basemap; isLand: (lon: number, lat: number) => boolean; isIce: (lon: number, lat: number) => boolean };
  private meshes = new Map<number, Terrain>();
  private meshFor?: { base: Basemap; relief?: Relief };
  /** Every place ever shown, so the terrain keeps each one on land. Only grows, so filtering never rebuilds it. */
  private anchors = new Map<string, [number, number]>();
  private terrainNow: Terrain | null = null;
  private skyTex?: HTMLCanvasElement;
  /** Night Drive, Cross Stitch and Rose Window keep what they can reuse between frames here. */
  private neon = new NeonCache();
  private stitch = new StitchCache();
  private glass = new GlassCache();
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
  /** The land as projected for the current frame, for scenery that follows the coast. */
  private landPath: Path2D | null = null;

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
    let added = false;
    for (const d of dots) {
      const k = `${d.lon},${d.lat}`;
      if (!this.anchors.has(k)) {
        this.anchors.set(k, [d.lon, d.lat]);
        added = true;
      }
    }
    if (added) this.meshes.clear();
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
    zoom = Math.max(zoom, this.minZoom());
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
    const z1 = clamp(z0 * factor, this.minZoom(), MAX_ZOOM);
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

  /**
   * The furthest out the map may zoom. A tilted camera over the whole world at once shows mostly far haze and near
   * polar ice, so it starts, and stays, close enough to see the land it looks across.
   */
  private minZoom(): number {
    return this.mode === "2d" && this.theme.tilt ? (this.theme.tiltMinZoom ?? 1.8) : 1;
  }

  private fit() {
    if (!this.w || !this.h) return;
    this.zoom = Math.max(this.zoom, this.minZoom());
    if (this.mode === "3d") {
      this.baseScale = Math.min(this.w, this.h) * (this.theme.globeScale ?? 0.46);
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
      const halfDeg = (this.h / 2 / k) * DEG * (this.theme.tilt ? 0.5 : 1);
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
    // Under a tilted camera the ground is foreshortened, so a drag moves further north or south.
    this.lat = this.lat + (dy / k / (this.cam ? this.cam.cos : 1)) * DEG;
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
        this.zoom = clamp((this.pinch.zoom * this.pointerDist()) / this.pinch.dist, this.minZoom(), MAX_ZOOM);
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
        this.zoom = clamp(this.zoom * Math.exp(-e.deltaY * 0.0016), this.minZoom(), MAX_ZOOM);
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
      const d = Math.hypot((s.gx ?? s.x) - cx, (s.gy ?? s.y) - cy) - s.r * 0.5;
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
    if (kind === "honeycomb") {
      // Hexagon cells: outlines in the first ink, a lighter glint in the upper part of each cell in the second.
      const r = 6;
      const cw = Math.sqrt(3) * r;
      const pc = document.createElement("canvas");
      pc.width = Math.round(cw * this.dpr);
      pc.height = Math.round(3 * r * this.dpr);
      const g = pc.getContext("2d")!;
      g.scale(this.dpr, this.dpr);
      const hex = (cx: number, cy: number) => {
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 6 + (i * Math.PI) / 3;
          if (i === 0) g.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
          else g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        g.closePath();
      };
      g.lineWidth = 1.1;
      for (const [cx, cy] of [[cw / 2, 0], [0, 1.5 * r], [cw, 1.5 * r], [cw / 2, 3 * r]] as const) {
        hex(cx, cy);
        g.strokeStyle = ink;
        g.stroke();
        g.beginPath();
        g.arc(cx - r * 0.25, cy - r * 0.3, r * 0.22, 0, Math.PI * 2);
        g.fillStyle = ink2;
        g.fill();
      }
      p = this.ctx.createPattern(pc, "repeat")!;
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

  private makeCam(tilt: number): Cam {
    const a = tilt / DEG;
    return { cx: this.w / 2, cy: this.h / 2, sin: Math.sin(a), cos: Math.cos(a), d: this.h * (this.theme.tiltEye ?? 1), far: this.theme.tiltFar ?? 0.5 };
  }

  /** A point on the flat map, raised `lift` pixels, as the tilted camera sees it, with its perspective scale. */
  private tp(x: number, y: number, lift: number, cam: Cam): [number, number, number] {
    const v = y - cam.cy;
    const s = cam.d / Math.max(cam.d * 0.25, cam.d - v * cam.sin);
    return [cam.cx + (x - cam.cx) * s, cam.cy + v * cam.cos * s - lift * s, s];
  }

  private tiltStream(out: GeoStream, cam: Cam): GeoStream {
    return {
      point: (x, y) => {
        const q = this.tp(x, y, 0, cam);
        out.point(q[0], q[1]);
      },
      lineStart: () => out.lineStart(),
      lineEnd: () => out.lineEnd(),
      polygonStart: () => out.polygonStart(),
      polygonEnd: () => out.polygonEnd(),
      sphere: () => out.sphere?.(),
    };
  }

  /**
   * Where a place is drawn: its point on the ground (raised by the terrain in Polygon Kingdom, tilted by the camera)
   * and the camera's scale there. Null when it is off the map.
   */
  private placeAt(proj: GeoProjection, lon: number, lat: number): { x: number; y: number; s: number } | null {
    const p = proj([lon, lat]);
    if (!p) return null;
    const m = this.terrainNow;
    const hgt = m ? heightAt(m, lon, lat) * this.liftPx : 0;
    if (this.cam) {
      const [x, y, s] = this.tp(p[0], p[1], hgt, this.cam);
      return { x, y, s };
    }
    if (m && this.mode === "3d") {
      const [cx, cy] = proj.translate();
      const k = 1 + hgt / proj.scale();
      return { x: cx + (p[0] - cx) * k, y: cy + (p[1] - cy) * k, s: 1 };
    }
    return { x: p[0], y: p[1], s: 1 };
  }

  private liftPx = 0;

  /** A painted sky with clouds, panning with the camera as a game's skybox does. */
  private drawSky(colors: [string, string, string]) {
    const { ctx, w, h } = this;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, colors[0]);
    g.addColorStop(0.45, colors[1]);
    g.addColorStop(1, colors[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (!this.skyTex) {
      // A small cloud texture, drawn once and enlarged smoothed: puffy white tops with cool undersides.
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 48;
      const cg = c.getContext("2d")!;
      let seed = 3;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 7; i++) {
        const x = 8 + i * 18 + rnd() * 6, y = 14 + rnd() * 20, w0 = 10 + rnd() * 10;
        for (const [dx, dy, r, col] of [
          [0, 3, w0 * 0.7, "#c9cbe6"],
          [-w0 * 0.6, 2, w0 * 0.5, "#dfe2f2"],
          [w0 * 0.6, 2, w0 * 0.5, "#dfe2f2"],
          [0, 0, w0 * 0.62, "#ffffff"],
          [-w0 * 0.45, 0, w0 * 0.42, "#ffffff"],
          [w0 * 0.45, 0, w0 * 0.42, "#ffffff"],
        ] as const) {
          // Drawn a tile to each side as well, so a cloud crossing the edge wraps without a cut.
          for (const shift of [-128, 0, 128]) {
            cg.beginPath();
            cg.ellipse(x + dx + shift, y + dy, r, r * 0.55, 0, 0, Math.PI * 2);
            cg.fillStyle = col;
            cg.fill();
          }
        }
      }
      this.skyTex = c;
    }
    const band = h * 0.42;
    const tw = (band / 48) * 128 * 1.6;
    const off = -(((this.lon + 180) / 360) * tw * 2) % tw;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.9;
    for (let x = off - tw; x < w + tw; x += tw) ctx.drawImage(this.skyTex, x, 0, tw, band);
    ctx.restore();
  }

  private render() {
    const { ctx, w, h, theme: t } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const proj = this.projection();
    const R = proj.scale();
    // The tilted camera applies to the flat map; the globe is already a solid seen in perspective.
    const cam = this.mode === "2d" && t.tilt ? this.makeCam(t.tilt) : null;
    this.cam = cam;
    this.terrainNow = null;
    this.liftPx = R * 0.02;
    const view = cam ? { stream: (out: GeoStream) => proj.stream(this.tiltStream(out, cam)) } : proj;
    const path = geoPath(view as GeoProjection, ctx);
    // Detail follows the map's size on screen, never whether it is being dragged, so coasts, lakes and rivers
    // don't change shape when the map is touched or let go (decision 42). The whole world at once gets the light
    // file, where the finer one adds nothing visible and drags slowly; zooming in switches to the fine one.
    const map = (proj.scale() >= DETAIL_SCALE ? this.high : this.low) ?? this.low ?? this.high;

    if (t.surface && map) {
      // Night Drive, Cross Stitch and Rose Window draw land and sea their own way (decision 70). Places, arcs and
      // tuning are the same as in every design.
      this.drawSurface(proj, cam, view, map, t);
      drawDecor(ctx, proj, t, this.mode, [this.lon, this.lat]);
      this.drawArcs(path, proj);
      this.drawDots(proj);
      return;
    }

    if (t.sky) this.drawSky(t.sky);
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
    if (t.lowPoly && t.fog) {
      // The sea fades into the horizon's haze: toward the far edge of the tilted map, or toward the globe's rim.
      let g: CanvasGradient;
      if (cam) {
        const top = this.tp(cam.cx, geoPath(proj).bounds(SPHERE)[0][1], 0, cam)[1];
        g = ctx.createLinearGradient(0, top, 0, top + (cam.cy - top) * 0.9);
      } else g = ctx.createRadialGradient(w / 2, h / 2, R * 0.68, w / 2, h / 2, R * 1.02);
      g.addColorStop(cam ? 1 : 0, t.ocean);
      g.addColorStop(cam ? 0 : 1, t.fog);
      ctx.fillStyle = g;
    } else ctx.fillStyle = t.ocean;
    ctx.fill();

    ctx.save();
    outline();
    ctx.clip();

    if (t.lowPoly) {
      // Water: a soft low-resolution texture that moves with the world.
      ctx.save();
      ctx.globalCompositeOperation = "soft-light";
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = this.worldTexture(proj, 1.6);
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
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

    const scene: SceneryFrame = { ctx, proj, theme: t, mode: this.mode, center: [this.lon, this.lat], w, h, land: null, outline, redraw: () => this.request() };
    if (t.scenery) drawSceneryUnder(scene);

    ctx.beginPath();
    path(GRATICULE);
    ctx.strokeStyle = t.graticule;
    ctx.lineWidth = 0.6;
    ctx.setLineDash(t.graticuleDash);
    ctx.stroke();
    ctx.setLineDash([]);

    if (map && !t.lowPoly) this.drawMap(path, proj, map, t);
    if (this.mode === "3d" && t.shade) {
      // Lit from the upper left, darker toward the rim, so the globe reads as a solid.
      const g = ctx.createRadialGradient(w / 2 - R * 0.38, h / 2 - R * 0.42, R * 0.15, w / 2, h / 2, R * 1.02);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.55, "rgba(0,0,0,0)");
      g.addColorStop(1, t.shade);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.mode === "3d" && t.fog && !t.lowPoly) {
      // Distance haze toward the rim.
      const g = ctx.createRadialGradient(w / 2, h / 2, R * 0.55, w / 2, h / 2, R * 1.05);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, t.fog);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();

    // Terrain stands outside the clip, so mountains break the globe's outline and the tilted map's far edge.
    if (map && t.lowPoly) this.drawLowPoly(proj, t);

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
    if (t.scenery) drawScenery({ ...scene, land: map && !t.lowPoly ? this.landPath : null });
    this.drawArcs(path, proj);
    this.drawDots(proj);
  }

  private drawSurface(proj: GeoProjection, cam: Cam | null, view: { stream(out: GeoStream): GeoStream }, map: Basemap, t: Theme) {
    const base = this.low ?? this.high ?? map;
    if (!this.rasters || this.rasters.base !== base) {
      this.rasters = { base, isLand: raster(base.land), isIce: raster(base.ice) };
      this.meshes.clear();
    }
    const f: SurfaceFrame = {
      ctx: this.ctx,
      w: this.w,
      h: this.h,
      dpr: this.dpr,
      mode: this.mode,
      theme: t,
      proj,
      cam,
      tp: (x, y, lift) => (cam ? this.tp(x, y, lift, cam) : [x, y, 1]),
      view,
      zoom: this.zoom,
      lon: this.lon,
      lat: this.lat,
      map,
      low: base,
      relief: this.relief,
      isLand: this.rasters.isLand,
      isIce: this.rasters.isIce,
    };
    if (t.surface === "neon") drawNeon(f, this.neon);
    else if (t.surface === "stitch") drawStitch(f, this.stitch);
    else drawGlass(f, this.glass);
  }

  private n64Tex?: HTMLCanvasElement;

  /**
   * A low-resolution texture the way early 3D consoles showed them: a 32 by 32 tile of grey noise enlarged eight
   * times with smoothing, so the texels are big and blurry. Tied to the world's position, so it moves with the land
   * and sea instead of sliding under them. `scale` enlarges it further.
   */
  private worldTexture(proj: GeoProjection, scale = 1): CanvasPattern {
    if (!this.n64Tex) {
      const small = document.createElement("canvas");
      small.width = small.height = 96;
      const g = small.getContext("2d")!;
      const img = g.createImageData(32, 32);
      let seed = 21;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 32 * 32; i++) {
        const v = 128 + Math.round((rnd() - 0.5) * 90);
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) g.putImageData(img, x * 32, y * 32);
      const big = document.createElement("canvas");
      big.width = big.height = 768;
      const bg = big.getContext("2d")!;
      bg.imageSmoothingEnabled = true;
      bg.imageSmoothingQuality = "low";
      bg.drawImage(small, 0, 0, 768, 768);
      const tile = document.createElement("canvas");
      tile.width = tile.height = 256;
      tile.getContext("2d")!.drawImage(big, -256, -256);
      this.n64Tex = tile;
    }
    const p = this.ctx.createPattern(this.n64Tex, "repeat")!;
    const anchor = proj([0, 0]) ?? [0, 0];
    const a = this.cam ? this.tp(anchor[0], anchor[1], 0, this.cam) : anchor;
    const size = 256 * scale;
    p.setTransform(new DOMMatrix().translate(((a[0] % size) + size) % size, ((a[1] % size) + size) % size).scale(scale));
    return p;
  }

  private drawMap(path: ReturnType<typeof geoPath>, proj: GeoProjection, map: Basemap, t: Theme) {
    const { ctx } = this;
    // The coastline is projected once per frame and reused for every fill and stroke below. Projecting it again
    // for each ripple line cost more than the drawing itself.
    // Under a tilted camera the outlines go through it as well, so any design can take the tilt.
    const cam = this.cam;
    const seen = cam ? ({ stream: (out: GeoStream) => proj.stream(this.tiltStream(out, cam)) } as GeoProjection) : proj;
    const land = new Path2D();
    geoPath(seen, pathContext(land))(map.land);
    const coast = new Path2D();
    geoPath(seen, pathContext(coast))(map.coast);
    this.landPath = land;
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

  private work = new WeakMap<Terrain, { X: Float32Array; Y: Float32Array; S: Float32Array; stamp: Int32Array }>();
  private frameNo = 0;
  private fogStrings = new Map<number, string>();

  /**
   * Terrain the way early 3D games built their overworlds (decision 63): a grid of triangles with heights and
   * baked light, seen through the tilted camera or on the globe, standing on cliff walls along the coast, fading
   * into haze at the draw distance.
   */
  private drawLowPoly(proj: GeoProjection, t: Theme) {
    const { ctx, w, h: H } = this;
    const lp = t.lowPoly!;
    const base = this.low ?? this.high;
    if (!base) return;
    if (!this.rasters || this.rasters.base !== base) {
      this.rasters = { base, isLand: raster(base.land), isIce: raster(base.ice) };
      this.meshes.clear();
    }
    if (!this.meshFor || this.meshFor.base !== base || this.meshFor.relief !== this.relief) {
      this.meshFor = { base, relief: this.relief };
      this.meshes.clear();
    }
    const step = TERRAIN_STEPS.find(([z]) => this.zoom < z)![1];
    let m = this.meshes.get(step);
    if (!m) {
      m = buildTerrain({ ...lp, isLand: this.rasters.isLand, isIce: this.rasters.isIce, peaks: this.relief?.peaks ?? [], step, anchors: [...this.anchors.values()] });
      this.meshes.set(step, m);
    }
    this.terrainNow = m;
    const cam = this.cam;
    const globe = this.mode === "3d";
    const R = proj.scale();
    const [gcx, gcy] = proj.translate();
    const lift = this.liftPx;
    const fog = hexRgb(t.fog ?? "#ffffff");

    // Only triangles that can be on screen: the facing half of the globe, or a window around the flat map's centre
    // that reaches further north, toward the horizon, under the tilted camera.
    const T = m.rgb.length;
    const order: number[] = [];
    if (globe) {
      const [ux, uy, uz] = unitOf(this.lon, this.lat);
      for (let i = 0; i < T; i++) if (m.cx[i]! * ux + m.cy[i]! * uy + m.cz[i]! * uz > 0.06) order.push(i);
    } else {
      const degPerPx = DEG / R;
      const halfW = (w / 2) * degPerPx * (cam ? 1.9 : 1.1) + m.step * 2;
      const halfH = (H / 2) * degPerPx;
      const north = this.lat + halfH * (cam ? 3.5 : 1.2) + m.step * 2;
      const south = this.lat - halfH * 1.3 - m.step * 2;
      for (let i = 0; i < T; i++) {
        const dl = ((((m.clon[i]! - this.lon) % 360) + 540) % 360) - 180;
        if (Math.abs(dl) > halfW || m.clat[i]! > north || m.clat[i]! < south) continue;
        order.push(i);
      }
    }

    let wk = this.work.get(m);
    if (!wk) {
      const n = m.lon.length;
      wk = { X: new Float32Array(n), Y: new Float32Array(n), S: new Float32Array(n), stamp: new Int32Array(n) };
      this.work.set(m, wk);
    }
    const { X, Y, S, stamp } = wk;
    const frame = ++this.frameNo;
    // Each corner is projected once, on the ground; heights are added per triangle, since a plateau's corner and
    // the mountain beside it stand at different heights.
    const vert = (i: number) => {
      if (stamp[i] === frame) return;
      stamp[i] = frame;
      const p = proj([m.lon[i]!, m.lat[i]!])!;
      if (cam) {
        const q = this.tp(p[0], p[1], 0, cam);
        X[i] = q[0];
        Y[i] = q[1];
        S[i] = q[2];
      } else {
        X[i] = p[0];
        Y[i] = p[1];
        S[i] = globe ? Math.hypot(p[0] - gcx, p[1] - gcy) / R : 1;
      }
    };
    const r1 = (v: number) => Math.round(v * 10) / 10;
    /** A corner raised `hu` units, as SVG path coordinates. */
    const up = (i: number, hu: number): string => {
      const hp = hu * lift;
      if (cam) return `${r1(X[i]!)} ${r1(Y[i]! - hp * S[i]!)}`;
      if (globe) {
        const k = 1 + hp / R;
        return `${r1(gcx + (X[i]! - gcx) * k)} ${r1(gcy + (Y[i]! - gcy) * k)}`;
      }
      return `${r1(X[i]!)} ${r1(Y[i]! - hp)}`;
    };
    const heightOf = (t: number, v: number) => {
      const f = m.triH[t]!;
      return Number.isNaN(f) ? m.h[v]! : f;
    };
    // How far into the haze a point is: toward the draw distance on the tilted map, toward the rim on the globe.
    const haze = (i: number) => (cam ? (0.92 - S[i]!) / 0.3 : globe ? (S[i]! - 0.72) / 0.4 : 0);
    const colorOf = (rgb: number, i: number) => {
      const level = Math.round(Math.max(0, Math.min(1, haze(i))) * 8);
      const key = rgb * 16 + level;
      let col = this.fogStrings.get(key);
      if (!col) {
        col = fogged(rgb, fog, level / 8);
        this.fogStrings.set(key, col);
      }
      return col;
    };

    const tris = m.tris;
    const drawn: number[] = [];
    const shown = new Uint8Array(T);
    for (const i of order) {
      const a = tris[3 * i]!, b = tris[3 * i + 1]!, c = tris[3 * i + 2]!;
      vert(a);
      vert(b);
      vert(c);
      // Past the draw distance, the ground is gone into the haze.
      if (cam && Math.min(S[a]!, S[b]!, S[c]!) < 0.5) continue;
      const minX = Math.min(X[a]!, X[b]!, X[c]!), maxX = Math.max(X[a]!, X[b]!, X[c]!);
      if (!globe && maxX - minX > w / 3) continue;
      if (maxX < -40 || minX > w + 40) continue;
      const minY = Math.min(Y[a]!, Y[b]!, Y[c]!);
      if (minY > H + 60 || Math.max(Y[a]!, Y[b]!, Y[c]!) < -120) continue;
      drawn.push(i);
      shown[i] = 1;
    }

    // Shallows and cliffs along the coast, under the land. A cliff starts at its triangle's height.
    const depth = clamp(R * 0.018, 3, 14);
    const shallowText: string[] = [];
    const wallText: string[] = [];
    const coast = m.coast;
    for (let k = 0; k < coast.length; k += 2) {
      const a = coast[k]!, b = coast[k + 1]!;
      const tri = m.coastTri[k / 2]!;
      if (!shown[tri]) continue;
      const da = depth * (cam ? S[a]! : 1), db = depth * (cam ? S[b]! : 1);
      const ga = `${r1(X[a]!)} ${r1(Y[a]! + da)}`, gb = `${r1(X[b]!)} ${r1(Y[b]! + db)}`;
      shallowText.push(`M${ga}L${gb}`);
      wallText.push(`M${up(a, heightOf(tri, a))}L${up(b, heightOf(tri, b))}L${gb}L${ga}Z`);
    }
    const shallows = new Path2D(shallowText.join(""));
    const coastWalls = new Path2D(wallText.join(""));
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = depth * 1.6;
    ctx.strokeStyle = lp.shallows;
    ctx.globalAlpha = 0.85;
    ctx.stroke(shallows);
    ctx.globalAlpha = 1;
    ctx.fillStyle = lp.cliff[0];
    ctx.fill(coastWalls);
    ctx.restore();

    // Bands from far to near: a row of the grid on the tilted map (north is far), a ring of distance on the globe
    // (the rim is far). In each band the tops go first, then the step walls that hang from them. Paths are built
    // as SVG path text and handed to the canvas once per colour: thousands of separate moveTo and lineTo calls
    // cost more than the drawing itself.
    type Band = { tops: Map<string, string[]>; walls: Map<string, string[]> };
    const bands = new Map<number, Band>();
    const bandOf = (i: number) => (globe ? Math.round(S[tris[3 * i]!]! * 24) : Math.round(m.clat[i]! / m.step));
    const bandFor = (key: number) => {
      let b = bands.get(key);
      if (!b) bands.set(key, (b = { tops: new Map(), walls: new Map() }));
      return b;
    };
    const push = (map: Map<string, string[]>, col: string, text: string) => {
      const list = map.get(col);
      if (list) list.push(text);
      else map.set(col, [text]);
    };
    const landText: string[] = [];
    for (const i of drawn) {
      const a = tris[3 * i]!, b = tris[3 * i + 1]!, c = tris[3 * i + 2]!;
      const text = `M${up(a, heightOf(i, a))}L${up(b, heightOf(i, b))}L${up(c, heightOf(i, c))}Z`;
      push(bandFor(bandOf(i)).tops, colorOf(m.rgb[i]!, a), text);
      landText.push(text);
    }
    const cliffRgb = hexRgb(lp.cliff[0]);
    const cliffAt = (k: number) => ((Math.round(cliffRgb[0] * k) << 16) | (Math.round(cliffRgb[1] * k) << 8) | Math.round(cliffRgb[2] * k)) >>> 0;
    const wallText2: string[] = [];
    const st = m.steps;
    for (let k = 0; k < st.a.length; k++) {
      const north = st.north[k]!;
      if (!shown[north]) continue;
      const a = st.a[k]!, b = st.b[k]!;
      // Walls facing the viewer are lit; walls running toward the horizon fall into shadow.
      const dx = X[b]! - X[a]!, dy = Y[b]! - Y[a]!;
      const steep = Math.abs(dy) / (Math.hypot(dx, dy) || 1);
      const text = `M${up(a, st.hiA[k]!)}L${up(b, st.hiB[k]!)}L${up(b, st.loB[k]!)}L${up(a, st.loA[k]!)}Z`;
      push(bandFor(bandOf(north)).walls, colorOf(cliffAt(1 - 0.35 * steep), a), text);
      wallText2.push(text);
    }
    const land = new Path2D(landText.join(""));
    ctx.fillStyle = `rgb(${lp.grass.map((v) => Math.round(v * 0.85)).join(",")})`;
    ctx.fill(land);
    ctx.lineWidth = 0.8;
    const drawMap = (map: Map<string, string[]>) => {
      for (const [col, list] of map) {
        const path = new Path2D(list.join(""));
        ctx.fillStyle = col;
        ctx.strokeStyle = col;
        ctx.fill(path);
        ctx.stroke(path);
      }
    };
    for (const key of [...bands.keys()].sort((p, q) => q - p)) {
      const band = bands.get(key)!;
      drawMap(band.tops);
      drawMap(band.walls);
    }
    // Blurry low-resolution textures, tied to the world: grass on the tops, rock on the walls.
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = this.worldTexture(proj, 0.35);
    ctx.fill(land);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = this.worldTexture(proj, 0.5);
    ctx.fill(coastWalls);
    ctx.fill(new Path2D(wallText2.join("")));
    ctx.restore();

    // Round trees on trunks stand on the grass, never in a cell that holds a place.
    const size = clamp(2.6 + this.zoom * 0.5, 3, 7);
    const trunks: string[] = [], crowns: string[] = [], lights: string[] = [];
    const placed: [number, number, number][] = [];
    for (let j = 0; j < m.treeTri.length; j++) {
      if (!shown[m.treeTri[j]!]) continue;
      const lo = m.trees[3 * j]!, la = m.trees[3 * j + 1]!, th = m.trees[3 * j + 2]! * lift;
      const p = proj([lo, la]);
      if (!p) continue;
      let x: number, y: number, sc: number;
      if (cam) {
        const q = this.tp(p[0], p[1], th, cam);
        [x, y, sc] = q;
        if (sc < 0.55) continue;
      } else if (globe) {
        const k = 1 + th / R;
        x = gcx + (p[0] - gcx) * k;
        y = gcy + (p[1] - gcy) * k;
        sc = 1;
      } else {
        x = p[0];
        y = p[1] - th;
        sc = 1;
      }
      placed.push([x, y, size * sc]);
    }
    placed.sort((p, q) => p[1] - q[1]);
    for (const [x, y, z] of placed) {
      const rx = z, ry = z * 1.15, cy = y - z * 1.9;
      trunks.push(`M${r1(x - z * 0.22)} ${r1(y)}h${r1(z * 0.44)}v${r1(-z * 1.1)}h${r1(-z * 0.44)}Z`);
      crowns.push(`M${r1(x - rx)} ${r1(cy)}a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(2 * rx)} 0a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(-2 * rx)} 0Z`);
      const lx = x - rx * 0.3, ly = cy - ry * 0.35, lr = rx * 0.45;
      lights.push(`M${r1(lx - lr)} ${r1(ly)}a${r1(lr)} ${r1(lr * 0.8)} 0 1 0 ${r1(2 * lr)} 0a${r1(lr)} ${r1(lr * 0.8)} 0 1 0 ${r1(-2 * lr)} 0Z`);
    }
    if (placed.length) {
      ctx.save();
      ctx.fillStyle = "#6b3f1a";
      ctx.fill(new Path2D(trunks.join("")));
      const crown = new Path2D(crowns.join(""));
      ctx.fillStyle = "#2f9a2a";
      ctx.fill(crown);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#1c6a1a";
      ctx.stroke(crown);
      ctx.fillStyle = "#6fd24a";
      ctx.fill(new Path2D(lights.join("")));
      ctx.restore();
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
      const q = this.placeAt(proj, lon, lat);
      if (!q) continue;
      const { x, y } = q;
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
      const p = this.placeAt(proj, lon, lat);
      if (!p) continue;
      ctx.fillRect(p.x, p.y, 1, 1);
      ctx.fillRect(p.x + s * 0.8, p.y + s * 0.4, 1, 1);
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
      const p = this.placeAt(proj, lon, lat);
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
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
    const shown: { d: Dot; x: number; y: number; s: number }[] = [];
    for (const d of this.dots) {
      if (d.tier > level || !this.visible(d.lon, d.lat)) continue;
      const p = this.placeAt(proj, d.lon, d.lat);
      if (!p) continue;
      // Beyond the tilted camera's draw distance the map is haze; its places are reached by dragging closer.
      if (this.cam && p.s < this.cam.far) continue;
      if (p.x < -20 || p.y < -20 || p.x > this.w + 20 || p.y > this.h + 20) continue;
      shown.push({ d, x: p.x, y: p.y, s: p.s });
    }
    shown.sort((a, b) => b.d.weight - a.d.weight || b.d.count - a.d.count);
    const spots: Spot[] = [];
    const merge = MERGE_PX * screenK;
    // Spots bucketed by screen cell, so a zoomed-in view of several thousand places merges in one pass. The
    // earliest spot within reach wins, as a search through the whole list would find.
    const cells = new Map<number, number[]>();
    const cellKey = (cx: number, cy: number) => cx * 65536 + cy;
    for (const { d, x, y } of shown) {
      const [cx, cy] = [Math.floor(x / merge), Math.floor(y / merge)];
      let first = -1;
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (const k of cells.get(cellKey(cx + i, cy + j)) ?? []) if ((first < 0 || k < first) && Math.hypot(spots[k]!.x - x, spots[k]!.y - y) < merge) first = k;
      const near = spots[first];
      if (near) {
        near.indices.push(d.index);
        near.count += d.count;
        near.weight = Math.max(near.weight, d.weight);
        near.fresh ||= d.fresh;
      } else {
        const key = cellKey(cx, cy);
        cells.set(key, [...(cells.get(key) ?? []), spots.length]);
        spots.push({ indices: [d.index], lon: d.lon, lat: d.lat, x, y, r: 0, count: d.count, weight: d.weight, fresh: d.fresh });
      }
    }
    // Size follows the place's most important story and its number of reports (decision 46), so one major
    // story reads as larger than a busy city of minor ones. Colour still means only "reported in the last hour".
    // A marker never shrinks with distance: its size means the number of reports, not how far away it is.
    const float = !!t.lowPoly;
    for (const s of spots) {
      s.indices.sort((a, b) => a - b);
      s.r = Math.min(13, 1.4 + s.weight * 0.9 + Math.sqrt(s.count) * 0.8) * zoomK;
      if (float) {
        // Polygon Kingdom's markers float just above the ground, over a round shadow, as objects did in those games.
        s.gx = s.x;
        s.gy = s.y;
        s.y = s.y - s.r - 3;
      }
    }
    this.screen = spots;
    if (float) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      for (const s of spots) {
        ctx.beginPath();
        ctx.ellipse(s.gx!, s.gy!, s.r * 0.9, s.r * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    const tunedKey = this.tuned ? key(this.tuned) : null;
    let tunedAt: Spot | null = null;
    ctx.save();
    if (t.glow) ctx.shadowBlur = 8;
    // A circle, or a square snapped to whole canvas pixels for the pixel designs.
    // Every shape comes from marks.ts, the same outlines the Key draws (decision 72). The square snaps to whole
    // canvas pixels for the pixel designs.
    let cur: Path2D = new Path2D();
    let ox = 0;
    let oy = 0;
    const shape = (x: number, y: number, r: number) => {
      if (t.dotShape === "square") {
        cur = new Path2D();
        cur.rect(Math.round(x - r), Math.round(y - r), Math.round(r * 2), Math.round(r * 2));
        ox = oy = 0;
      } else {
        cur = markPath2D(t.dotShape, r);
        ox = x;
        oy = y;
      }
    };
    const fillShape = () => {
      ctx.translate(ox, oy);
      ctx.fill(cur);
      ctx.translate(-ox, -oy);
    };
    const strokeShape = () => {
      ctx.translate(ox, oy);
      ctx.stroke(cur);
      ctx.translate(-ox, -oy);
    };
    /** A light-and-shade gradient centred on the marker, filled over its shape. */
    const shadeShape = (x: number, y: number, r: number, stops: [number, string][]) => {
      const g = ctx.createRadialGradient(x - r * 0.33, y - r * 0.38, 0, x, y, r);
      for (const [at, c] of stops) g.addColorStop(at, c);
      ctx.fillStyle = g;
      const p = new Path2D();
      p.addPath(cur, new DOMMatrix([1, 0, 0, 1, ox, oy]));
      ctx.fill(p);
    };
    // Three symbols by the place's most important story (decision 57), drawn least important first so the most
    // important always sit on top: hollow for importance 1 and GDELT local stories, filled for 2 and 3, filled
    // with an outer ring for 4 and 5. Colour still means only "reported in the last hour".
    for (const s of [...spots].reverse()) {
      const { x, y, r } = s;
      const ink = s.fresh ? t.fresh : t.dot;
      const hollow = s.weight <= 1;
      if (t.glow) ctx.shadowColor = ink;
      shape(x, y, r);
      ctx.fillStyle = hollow ? t.dotStroke : ink;
      fillShape();
      if (t.dotShape === "bevel" && !hollow) {
        // A bevelled disc: light on the upper left, a darker rim below.
        ctx.save();
        ctx.shadowBlur = 0;
        shadeShape(x, y, r, [[0, "rgba(255,255,255,0.65)"], [0.45, "rgba(255,255,255,0)"], [1, "rgba(0,0,0,0.25)"]]);
        ctx.restore();
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
      }
      if (t.dotShape === "button" && !hollow) {
        // A sewn button: a raised rim, four holes and the thread crossed through them. Size and rings still mean
        // what they mean in every design.
        ctx.save();
        ctx.shadowBlur = 0;
        shadeShape(x, y, r, [[0, "rgba(255,255,255,0.35)"], [0.6, "rgba(255,255,255,0)"], [1, "rgba(0,0,0,0.3)"]]);
        if (r >= 3.5) {
          const o = r * 0.3;
          ctx.beginPath();
          ctx.moveTo(x - o, y - o);
          ctx.lineTo(x + o, y + o);
          ctx.moveTo(x + o, y - o);
          ctx.lineTo(x - o, y + o);
          ctx.lineWidth = Math.max(1, r * 0.16);
          ctx.lineCap = "round";
          ctx.strokeStyle = t.dotStroke;
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.lineWidth = hollow ? 1.6 : 1.2;
      ctx.strokeStyle = hollow ? ink : t.dotStroke;
      strokeShape();
      const ring = s.weight >= 4 ? r + 2.6 : r;
      if (s.weight >= 4) {
        shape(x, y, ring);
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = ink;
        strokeShape();
      }
      if (s.indices.length > 1) {
        // Merged places: a thin inner ring, so a cluster reads differently from one busy city.
        shape(x, y, Math.max(1.2, r * 0.45));
        ctx.lineWidth = 1;
        ctx.strokeStyle = hollow ? ink : t.dotStroke;
        strokeShape();
      }
      if (s.fresh && t.fresh === t.dot) {
        // Monochrome designs mark fresh reports with a dashed ring, so it never reads as the importance ring.
        ctx.save();
        ctx.setLineDash([2, 2]);
        shape(x, y, ring + 2.6);
        ctx.lineWidth = 0.9;
        ctx.strokeStyle = t.dot;
        strokeShape();
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
