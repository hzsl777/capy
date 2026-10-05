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
import { beanCrease2D, buoyBand2D, cubeFaces2D, markPath2D, markRing2D } from "./marks.ts";
import type { SceneryFrame } from "./scenery.ts";
import type { Terrain } from "./terrain.ts";
import { minimapFrame } from "./minimap.ts";
import { ambientDelay } from "./ambient.ts";
import { Detail, cellsInView, grown, ringFor, tolFor } from "./detail.ts";
import { CELL } from "./cells.ts";
import type { SurfaceFrame, SurfaceResult } from "./surface.ts";
import { makeWarp, warpStream, type Warp } from "./warp.ts";
import { readerTilt, stepTilt, tiltRange, twoFingerGesture, TILT_KEY_STEP, TILT_PER_PX } from "./tilt.ts";
import type { Camera } from "./fold.ts";
import type { Scenes } from "./scene-view.ts";
// Everything a design brings (its surface, its kits) is looked up here; the design's own entry registers it
// (src/designs/<id>.ts), so a design's drawing code is only loaded when the design is shown.
import { kits, surfaceOf } from "../registry.ts";

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
  /** A frame was drawn: the view may have moved or zoomed. Called often; keep it cheap. */
  onDraw?(): void;
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
export interface Cam {
  cx: number;
  cy: number;
  sin: number;
  cos: number;
  /** Distance from the eye to the picture, in pixels. Smaller means stronger perspective. */
  d: number;
  /** The draw distance: nothing is drawn where the camera's scale falls below this. */
  far: number;
}

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

export const SPHERE: GeoPermissibleObjects = { type: "Sphere" };
export const GRATICULE = geoGraticule().step([15, 15])();

type PatternKind = "halftone" | "matrix" | "dither" | "hatch" | "blocks" | "grass" | "brush" | "mottle" | "honeycomb" | "lilypads" | "crunch" | "tiles" | "shimmer";

export const DEG = 180 / Math.PI;
const TUNE_RADIUS = 22;
/**
 * When a drag ends, the nearest place within this many pixels of the reticle glides under it, as a spin's landing does,
 * so the reticle always meets the place it tunes, in every design and on a phone (decision 125).
 */
const SNAP_RADIUS = 48;
/** How high Polygon Kingdom's terrain stands: a height of 1 is this share of the projection's scale, in pixels. */
const LIFT = 0.02;
const MAX_ZOOM = 14;
/** Screen distance under which pins merge into one dot. */
const MERGE_PX = 13;
/** The cell places are kept in for the globe to pass over (degrees), and the most any point is from its middle (radians). */
const DOT_CELL = 10;
const DOT_CELL_RADIUS = 0.125;
/** d3 draws into anything canvas-like; a Path2D only lacks beginPath, which a fresh path doesn't need. */
function pathContext(p: Path2D) {
  return { beginPath() {}, moveTo: p.moveTo.bind(p), lineTo: p.lineTo.bind(p), arc: p.arc.bind(p), closePath: p.closePath.bind(p) };
}

/**
 * Like `pathContext`, but a point within `min` pixels of the last one drawn is skipped, so a long, finely sampled line
 * costs the canvas fewer segments. A short line (an islet of a few pixels) is kept whole, so it still strokes as a
 * round blob and not as a bar. Each line's last point is always drawn; call `end` after the last line.
 */
function sparseContext(p: Path2D, min: number) {
  let line: number[] = [];
  const flush = () => {
    if (!line.length) return;
    p.moveTo(line[0]!, line[1]!);
    if (line.length <= 24) for (let i = 2; i < line.length; i += 2) p.lineTo(line[i]!, line[i + 1]!);
    else {
      let lx = line[0]!, ly = line[1]!;
      const end = line.length - 2;
      for (let i = 2; i < end; i += 2) {
        const x = line[i]!, y = line[i + 1]!;
        if ((x - lx) * (x - lx) + (y - ly) * (y - ly) < min * min) continue;
        p.lineTo(x, y);
        lx = x;
        ly = y;
      }
      p.lineTo(line[end]!, line[end + 1]!);
    }
    line = [];
  };
  return {
    beginPath() {},
    moveTo(x: number, y: number) {
      flush();
      line.push(x, y);
    },
    lineTo(x: number, y: number) {
      line.push(x, y);
    },
    arc: p.arc.bind(p),
    closePath() {
      flush();
      p.closePath();
    },
    end: flush,
  };
}

/** Pixels drawn beyond the frame on the flat map: more than the widest coast ripple line. */
const CLIP_MARGIN = 48;

/** Projection scale (about the globe's radius in pixels) from which the detailed basemap is drawn. */
export const DETAIL_SCALE = 520;
/**
 * From this scale the 10m cells in view are drawn instead of 50m (src/map/detail.ts): a pixel is about 3.5 kilometres,
 * where 50m's coast, several kilometres out, starts to show against a town's dot. They are asked for from 0.8 of it, so
 * they are here when it is reached, and let go below 0.7 of it.
 */
const DETAIL10_SCALE = 1800;

/** Resampling precision in pixels. One value for every frame, so outlines never shift between frames. */
const PRECISION = 0.5;

/** Degrees per second for the idle spin. */
const SPIN_SPEED = 7;
/** The spin turns at least this long before it may land, so it reads as a spin. */
const SPIN_MIN_MS = 2500;
const key = (indices: number[]) => indices.join(",");

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
  ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  dpr = 1;
  baseScale = 1;

  lon = 15;
  lat = 15;
  zoom = 1;
  mode: ViewMode = "2d";
  theme: Theme;

  low?: Basemap;
  high?: Basemap;
  private detail?: Detail;
  private detailCells?: { key: string; cells: ReturnType<typeof cellsInView>; ring: ReturnType<typeof cellsInView> };
  private mapIds = new WeakMap<Basemap, number>();
  private mapSeq = 0;
  /** True while the frame being drawn uses the 10m cells. */
  private detailing = false;
  relief?: Relief;
  cam: Cam | null = null;
  rasters?: { base: Basemap; isLand: (lon: number, lat: number) => boolean; isIce: (lon: number, lat: number) => boolean };
  meshes = new Map<number, Terrain>();
  meshFor?: { base: Basemap; relief?: Relief };
  /** Every place ever shown, so the terrain keeps each one on land. Only grows, so filtering never rebuilds it. */
  anchors = new Map<string, [number, number]>();
  terrainNow: Terrain | null = null;
  private skyTex?: HTMLCanvasElement;
  private ambientTimer = 0;
  private recordAt: [number, number] | null = null;
  /**
   * Folding Cube (src/map/fold.ts): the opening, played once per page load, and the fold between Map and Globe view,
   * each from the time it began. Places are always placed and tuned at rest (`foldRest`), and while either runs they
   * are not drawn.
   */
  private foldIntro: { start: number; off: () => void } | null = null;
  private foldIntroPlayed = false;
  private foldTurn: { start: number; from: ViewMode } | null = null;
  private foldRest: Camera | null = null;
  private warp: Warp | null = null;
  private warpFor = "";
  private motionTimer = 0;
  private lastDraw = 0;
  /** Where the current or last drag passed on screen, for Chalkboard's smudge. */
  private trail: { x: number; y: number; t: number }[] = [];
  /** The next frame a handmade design's own motion asked for (the train, the line boil, a fading smudge). */
  private handTimer = 0;
  private dots: Dot[] = [];
  /**
   * The same places by 10-degree cell of longitude and latitude, so the globe passes over whole cells on its far
   * side or off screen instead of looking at each of tens of thousands of towns (decision 78).
   */
  private dotCells: { lon: number; lat: number; dots: Dot[] }[] = [];
  private screen: Spot[] = [];
  private tuned: number[] | null = null;
  private lastLevel = -1;
  spinning = false;
  private spinFrame = 0;
  /** The spot under the reticle when the spin started, so it doesn't land where it began. */
  private spinSkip: string | null = null;
  private spinStarted = 0;
  private pinned = new Set<number>();
  private arcs: { from: [number, number]; to: [number, number][] } | null = null;
  /** Places tied to what the panel shows (the telegram's events, or one event). Drawn with a dashed ring. */
  private highlight = new Set<number>();

  anim: Anim | null = null;
  private frame = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; t: number } | null = null;
  private velocity = { x: 0, y: 0, t: 0 };
  /**
   * Two fingers down: where they started (gap and midpoint height), the zoom and tilt then, and whether they are
   * pinching or tilting, which is decided once they have moved a little.
   */
  private pinch: { dist: number; zoom: number; mid: number; by: number; mode: "tilt" | "pinch" | null } | null = null;
  /** A tilt drag with the right mouse button, or Shift or Ctrl held: where it started and the reader's tilt then. */
  private tiltDrag: { y: number; by: number } | null = null;
  /** The reader's change to the camera's tilt in Map view, in degrees (src/map/tilt.ts). Reset with the design. */
  private tiltOffset = 0;
  private patterns = new Map<string, CanvasPattern>();
  /** The land as projected for the current frame, for scenery that follows the coast. */
  private landPath: Path2D | null = null;

  constructor(
    readonly container: HTMLElement,
    theme: Theme,
    private events: MapEvents,
  ) {
    this.theme = theme;
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("role", "img");
    this.label();
    this.canvas.tabIndex = 0;
    container.prepend(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(container);
    // A design's own motion pauses while the tab is hidden and picks up again when it shows.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.request();
    });
    this.bindInput();
    this.resize();
    document.addEventListener("visibilitychange", () => this.syncMotion());
    this.syncMotion();
  }

  /**
   * Designs that move on their own (decision 75) are redrawn at most 20 times a second, never while the tab is
   * hidden, and not at all for readers who ask for reduced motion.
   */
  private syncMotion() {
    clearInterval(this.motionTimer);
    this.motionTimer = 0;
    if (!this.theme.motion || this.still() || document.hidden) return;
    this.motionTimer = window.setInterval(() => {
      if (performance.now() - this.lastDraw > 45) this.request();
    }, 50);
  }

  private still(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // ---- public API -------------------------------------------------------

  setBasemap(low?: Basemap, high?: Basemap, relief?: Relief) {
    if (low) this.low = low;
    if (high) this.high = high;
    if (relief) this.relief = relief;
    this.request();
  }

  /** The 10m cells live under `base`: the view asks for the ones it shows once zoomed in far enough. */
  setDetail(base: string) {
    this.detail = new Detail(base, () => this.request());
  }

  /**
   * The basemap to draw: the 10m cells in view once a pixel is a few kilometres, else `map` as it is. Not under a tilted
   * camera, whose far reaches would need more cells than the near ones, nor for a design that keeps 50m (`detail`).
   */
  detailMap(proj: GeoProjection, map: Basemap | undefined, cam: Cam | null, t: Theme): Basemap | undefined {
    this.detailing = false;
    const d = this.detail;
    const high = this.high;
    if (!d || !high || !map) return map;
    const k = proj.scale();
    if (k < DETAIL10_SCALE * 0.7 || t.detail === false) {
      if (d.size) d.clear();
      return map;
    }
    if (cam || k < DETAIL10_SCALE * 0.8) return map;
    const ext = this.warpExtent() ?? [[-CLIP_MARGIN, -CLIP_MARGIN], [this.w + CLIP_MARGIN, this.h + CLIP_MARGIN]];
    const pad = 24;
    const key = `${this.mode}:${this.lon.toFixed(4)}:${this.lat.toFixed(4)}:${k.toFixed(2)}:${this.w}:${this.h}:${ext[0]!.join()}:${ext[1]!.join()}`;
    if (this.detailCells?.key !== key) {
      const mid = proj.invert?.([this.w / 2, this.h / 2]);
      const cells = cellsInView((p) => proj(p), { x0: ext[0]![0] - pad, y0: ext[0]![1] - pad, x1: ext[1]![0] + pad, y1: ext[1]![1] + pad }, mid && Number.isFinite(mid[0]) && Number.isFinite(mid[1]) ? mid : null);
      this.detailCells = { key, cells, ring: grown(cells, ringFor(((k * CELL) / DEG) * Math.cos(Math.min(70, Math.abs(this.lat)) / DEG))) };
    }
    const { cells, ring } = this.detailCells;
    const got = d.update(high, cells, ring, k >= DETAIL10_SCALE, tolFor(k));
    this.detailing = !!got;
    return got ?? map;
  }

  /** A number for each basemap the view hands out, so a design that keeps a picture can tell when the basemap changed. */
  private mapId(map: Basemap): number {
    let id = this.mapIds.get(map);
    if (!id) this.mapIds.set(map, (id = ++this.mapSeq));
    return id;
  }

  setTheme(theme: Theme) {
    const resample = theme.pixel !== this.theme.pixel;
    this.theme = theme;
    this.tiltOffset = 0;
    this.label();
    this.patterns.clear();
    if (resample) this.resize();
    this.fit();
    this.syncMotion();
    this.request();
  }

  setMode(mode: ViewMode) {
    // Folding Cube folds the net into the cube or opens it out, never for reduced motion or in a hidden tab.
    if (this.isFold() && mode !== this.mode && !this.still() && !document.hidden && this.w > 1) this.foldTurn = { start: performance.now(), from: this.mode };
    this.mode = mode;
    this.label();
    this.fit();
    this.request();
  }

  setDots(dots: Dot[]) {
    this.dots = [...dots].sort((a, b) => a.count - b.count);
    const cells = new Map<number, { lon: number; lat: number; dots: Dot[] }>();
    for (const d of this.dots) {
      const [y, x] = [Math.floor(d.lat / DOT_CELL), Math.floor(d.lon / DOT_CELL)];
      const k = y * 1000 + x;
      let c = cells.get(k);
      if (!c) cells.set(k, (c = { lon: (x + 0.5) * DOT_CELL, lat: (y + 0.5) * DOT_CELL, dots: [] }));
      c.dots.push(d);
    }
    this.dotCells = [...cells.values()];
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

  /** The zoom at which `level` begins, a little past the step, for flying to a place that shows only there. */
  levelZoom(level: number): number {
    const steps = this.mode === "3d" ? [1.6, 2.4, 3.4, 4.8] : [1.4, 2.1, 3, 4.2];
    return Math.min(MAX_ZOOM, level <= 0 ? this.zoom : steps[Math.min(level, steps.length) - 1]! * 1.15);
  }

  /**
   * Whether any of a cell of longitude and latitude is on screen, tested at points a degree or so apart through the
   * same camera as the places: which tiles of local stories to load (decision 78).
   */
  cellInView(south: number, west: number, north: number, east: number): boolean {
    const off = wrap(this.lon - west);
    if (this.lat >= south && this.lat < north && off >= 0 && off < east - west) return true;
    const proj = this.projection();
    const n = Math.max(4, Math.ceil(Math.max(north - south, east - west)));
    const m = 40;
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) {
        const lon = west + ((east - west) * i) / n;
        const lat = south + ((north - south) * j) / n;
        if (!this.visible(lon, lat)) continue;
        const p = this.placeAt(proj, lon, lat);
        if (!p || (this.cam && p.s < this.cam.far)) continue;
        if (p.x >= -m && p.y >= -m && p.x <= this.w + m && p.y <= this.h + m) return true;
      }
    return false;
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
      this.lon = wrap(this.lon + (this.isRecord() ? kits.vinyl!.recordSpin() : SPIN_SPEED) * dt);
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

  /**
   * How close a flight to a place comes. A globe framed by something of its own (a hoop, a stone window, a snow
   * globe's dome) stays at its full size, so the frame isn't cut off, and so do Folding Cube's cube and its net.
   */
  private landingZoom(): number {
    if (this.isFold()) return 1;
    if (this.mode === "3d") return this.theme.globeScale ? 1 : 1.6;
    return 1.4;
  }

  flyTo(lon: number, lat: number, zoom = Math.max(this.zoom, this.landingZoom()), duration = 900) {
    zoom = Math.max(zoom, this.minZoom());
    const from: [number, number] = [this.lon, this.lat];
    const to: [number, number] = [lon, lat];
    const z0 = this.zoom;
    const interp = geoInterpolate(from, to);
    const dlon = wrap(lon - this.lon);
    // On Folding Cube's net the flight goes straight across the faces, so it never jumps where the net is cut open.
    const net = this.isFold() && this.mode === "2d" ? [kits.fold!.netPoint(this.lon, this.lat), kits.fold!.netPoint(lon, lat)] : null;
    this.startAnim(duration, (t) => {
      const k = ease(t);
      this.zoom = z0 + (zoom - z0) * k;
      if (net) {
        const [[x0, y0], [x1, y1]] = net as [[number, number], [number, number]];
        [this.lon, this.lat] = t >= 1 ? [lon, lat] : kits.fold!.netInvert(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
      } else if (this.isRecord()) {
        // The record turns the short way and the arm swings across: straight in longitude and latitude, not over the pole.
        this.lon = wrap(from[0] + dlon * k);
        this.lat = from[1] + (lat - from[1]) * k;
      } else if (this.mode === "3d") {
        const [x, y] = interp(k);
        this.lon = x;
        this.lat = y;
      } else {
        this.lon = wrap(from[0] + dlon * k);
        this.lat = from[1] + (this.groundLat(lon, lat) - from[1]) * k;
      }
      this.clampLat();
    });
    this.landing = [lon, lat];
  }

  /**
   * Where the last flight landed, kept until the map is next moved another way, so the place stays under the
   * reticle when the terrain under it changes (a finer mesh as the flight ends, a tile of local stories arriving).
   */
  private landing: [number, number] | null = null;

  /**
   * The centre latitude that puts a place's drawn point under the reticle. Polygon Kingdom's tilted camera draws a
   * place raised by its terrain, so the flat ground at the centre is the point `height / cos(tilt)` pixels north of
   * it on the flat map. Every other design, and the globe, centres the place itself.
   */
  private groundLat(lon: number, lat: number): number {
    const m = this.terrainNow;
    if (!m || !this.cam || this.mode !== "2d") return lat;
    const proj = this.projection();
    const p = proj([lon, lat]);
    const v = (kits.lowPoly!.heightAt(m, lon, lat) * proj.scale() * LIFT) / Math.cos(this.tiltAngle() / DEG);
    const c = p && proj.invert?.([p[0], p[1] - v]);
    return c ? c[1] : lat;
  }

  /** After a flight, move the centre if the terrain under the landed place changed. */
  private settle(): boolean {
    if (!this.landing || this.anim) return false;
    const before = this.lat;
    this.lat = this.groundLat(...this.landing);
    this.clampLat();
    return (Math.abs(this.lat - before) / DEG) * this.baseScale * this.zoom > 0.25;
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
    this.recordAt = null;
    this.pan(dx, dy);
    this.moved();
  }

  center(): [number, number] {
    return [this.lon, this.lat];
  }

  /**
   * About how many kilometres one screen pixel spans east to west at the reticle, measured through the same camera
   * as the places (Pin Drop's scale bar). Null when the centre is off the picture.
   */
  kmPerPixel(): number | null {
    const proj = this.projection();
    const a = this.placeAt(proj, this.lon, this.lat);
    const b = this.placeAt(proj, this.lon + 0.5, this.lat);
    if (!a || !b) return null;
    const px = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(px > 0.01)) return null;
    return (geoDistance([this.lon, this.lat], [this.lon + 0.5, this.lat]) * 6371) / px;
  }

  /** Jump without animating, e.g. to a random longitude before the first spin. */
  setCenter(lon: number, lat: number) {
    this.landing = null;
    this.lon = wrap(lon);
    this.lat = lat;
    this.clampLat();
    this.request();
  }

  /**
   * Shortwave's tuning dial (src/ui/dial.ts) turns the world east or west as a drag on the map would: the spin and any
   * flight stop, the latitude stays. `turnTo` goes to a longitude; `turnBy` moves the reticle east by `px` screen pixels.
   */
  turnTo(lon: number) {
    this.touched();
    this.stopAnim();
    this.lon = wrap(lon);
    this.moved();
  }

  turnBy(px: number) {
    this.touched();
    this.stopAnim();
    this.pan(-px, 0);
    this.moved();
  }

  /**
   * More for Shortwave's radio front (src/ui/dial.ts). `snapSoon` is what letting go of a drag does: the next drawn
   * frame glides the nearest place under the reticle. `nearestPx` is how far, in screen pixels, the nearest place
   * drawn is from the reticle (null when none is drawn), measured the same for every place so that it says only how
   * near, never which. `bandTo` zooms to the start of a zoom level, level 0 being the whole world, like a band switch.
   */
  snapSoon() {
    this.snapNext = true;
    this.request();
  }

  nearestPx(): number | null {
    let best: number | null = null;
    for (const s of this.screen) {
      const d = Math.hypot((s.gx ?? s.x) - this.w / 2, (s.gy ?? s.y) - this.h / 2);
      if (best === null || d < best) best = d;
    }
    return best;
  }

  bandTo(level: number) {
    // A snap still waiting for the next frame would fly to its place at the zoom this one is leaving.
    this.snapNext = false;
    this.zoomBy((level <= 0 ? this.minZoom() : this.levelZoom(level)) / this.zoom);
  }

  // ---- geometry ---------------------------------------------------------

  projection(): GeoProjection {
    // Record Player's Globe view: the record seen from the tonearm, the needle on the frame's centre.
    if (this.isRecord())
      return kits.vinyl!.recordProjection(this.lon, this.lat, this.zoom, this.w, this.h, [
        [-CLIP_MARGIN, -CLIP_MARGIN],
        [this.w + CLIP_MARGIN, this.h + CLIP_MARGIN],
      ]);
    if (this.mode === "3d") {
      return geoOrthographic()
        .rotate([-this.lon, -this.lat])
        .scale(this.baseScale * this.zoom)
        .translate([this.w / 2, this.h / 2])
        .clipAngle(90)
        .clipExtent(
          this.warpExtent() ?? [
            [-CLIP_MARGIN, -CLIP_MARGIN],
            [this.w + CLIP_MARGIN, this.h + CLIP_MARGIN],
          ],
        )
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
      .clipExtent(
        this.warpExtent() ?? [
          [-CLIP_MARGIN, -CLIP_MARGIN],
          [this.w + CLIP_MARGIN, this.h + CLIP_MARGIN],
        ],
      )
      .precision(PRECISION);
  }

  /** Under a warp (decision 75), the part of the flat picture that lands on screen: the frame's edges taken back. */
  private warpExtent(): [[number, number], [number, number]] | null {
    const wp = this.warp;
    if (!wp) return null;
    const { w, h } = this;
    const pts = [[0, 0], [w, 0], [0, h], [w, h], [w / 2, 0], [w / 2, h], [0, h / 2], [w, h / 2]].map(([x, y]) => wp.inv(x!, y!));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const lim = 4 * Math.max(w, h);
    return [
      [Math.max(-lim, Math.min(0, ...xs) - CLIP_MARGIN), Math.max(-lim, Math.min(0, ...ys) - CLIP_MARGIN)],
      [Math.min(lim, Math.max(w, ...xs) + CLIP_MARGIN), Math.min(lim, Math.max(h, ...ys) + CLIP_MARGIN)],
    ];
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
    if (this.isFold()) {
      // Pixels per cube face half-width: the whole net in Map view, a cube about the globe's size in Globe view.
      this.baseScale = kits.fold!.foldBase(this.mode, this.w, this.h);
    } else if (this.isRecord()) {
      // Record Player: the record's radius, on a turntable laid out to fit the frame (src/map/vinyl.ts).
      this.baseScale = kits.vinyl!.recordBase(this.w, this.h);
    } else if (this.mode === "3d") {
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
    if (this.isRecord()) {
      // The needle stops short of the centre label and goes as far as the record's edge, the South Pole.
      this.lat = clamp(this.lat, kits.vinyl!.NEEDLE_LAT[0], kits.vinyl!.NEEDLE_LAT[1]);
    } else if (this.isFold() && this.mode === "2d") {
      // The net has the poles in the middle of its top and bottom faces, so the centre may go all the way.
      this.lat = clamp(this.lat, -90, 90);
    } else if (this.mode === "3d") {
      this.lat = clamp(this.lat, -80, 80);
    } else {
      const k = this.baseScale * this.zoom;
      // A tilted camera shows the far side smaller, so the centre may go nearer the pole; a reader's tilt eases in.
      const far = this.tiltOffset ? 1 - 0.5 * Math.min(1, this.tiltAngle() / 45) : this.theme.tilt ? 0.5 : 1;
      const halfDeg = (this.h / 2 / k) * DEG * far;
      const max = Math.max(0, 84 - halfDeg);
      this.lat = clamp(this.lat, -max, max);
    }
  }

  /**
   * The cosine of the angle between a point and the view's centre. The same test as d3's geoDistance, which sums
   * with extra precision and is too slow to run for tens of thousands of places a frame (decision 78).
   */
  private cosFromCenter(lon: number, lat: number): number {
    const r = Math.PI / 180;
    return Math.sin(lat * r) * Math.sin(this.lat * r) + Math.cos(lat * r) * Math.cos(this.lat * r) * Math.cos((lon - this.lon) * r);
  }

  private visible(lon: number, lat: number): boolean {
    // On the cube, which faces show decides (placeAt), not the distance from the centre.
    if (this.mode === "2d" || this.isFold()) return true;
    // The whole world is on the record; only the cap under the centre label, where no place lies, is hidden.
    if (this.isRecord()) return 90 - lat > kits.vinyl!.CAP;
    return this.cosFromCenter(lon, lat) > Math.sin(0.03);
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

  private pan(dx: number, dy: number, at?: [number, number]) {
    if (this.isRecord()) {
      // Record Player: the record turns with the finger round its spindle and the arm swings by as far as the finger goes
      // in or out (src/map/vinyl.ts). Without a finger (a glide, the arrow keys), as if dragged at the needle.
      const [nx, ny] = this.reticle();
      if (!at && !this.recordAt) {
        // The arrow keys: left and right turn the record, up and down swing the arm.
        if (dx) [this.lon, this.lat] = kits.vinyl!.dragRecord(this.lon, this.lat, this.zoom, this.w, this.h, [nx, ny], [nx + dx, ny], "turn");
        if (dy) [this.lon, this.lat] = kits.vinyl!.dragRecord(this.lon, this.lat, this.zoom, this.w, this.h, [nx, ny], [nx, ny + dy], "swing");
        return;
      }
      const to: [number, number] = at ?? [this.recordAt![0] + dx, this.recordAt![1] + dy];
      if (this.recordAt || at) this.recordAt = to;
      [this.lon, this.lat] = kits.vinyl!.dragRecord(this.lon, this.lat, this.zoom, this.w, this.h, [to[0] - dx, to[1] - dy], to);
      return;
    }
    // Under a warp a drag moves the flat picture under the centre by as much as it moves on screen (decision 75).
    if (this.warp) [dx, dy] = this.warp.unpan(dx, dy);
    const k = this.baseScale * this.zoom * (this.sceneKit()?.sceneMag() ?? 1);
    if (this.isFold() && this.mode === "2d") {
      // Folding Cube's net moves under the finger and the centre stays on it, so the reticle always has a place.
      const [x, y] = kits.fold!.netPoint(this.lon, this.lat);
      [this.lon, this.lat] = kits.fold!.netInvert(x - dx / k, y + dy / k);
      return;
    }
    this.lon = wrap(this.lon - (dx / k) * DEG);
    // Under a tilted camera the ground is foreshortened, so a drag moves further north or south.
    this.lat = this.lat + (dy / k / (this.cam ? this.cam.cos : 1)) * DEG;
    this.clampLat();
  }

  private bindInput() {
    const c = this.canvas;
    // The right button tilts the map where it can, so there the browser's menu stays off the canvas; elsewhere the
    // right button does nothing to the map and the menu is the browser's as usual.
    c.addEventListener("contextmenu", (e) => {
      if (this.canTilt()) e.preventDefault();
    });
    c.addEventListener("pointerdown", (e) => {
      if (e.button === 2 && !this.canTilt()) return;
      this.touched();
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.stopAnim();
      const tiltButton = e.button === 2 || (e.button === 0 && (e.shiftKey || e.ctrlKey));
      if (this.pointers.size === 1 && tiltButton && this.canTilt()) {
        this.tiltDrag = { y: e.clientY, by: this.tiltOffset };
        this.down = null;
      } else if (this.pointers.size === 1) {
        this.recordAt = null;
        this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
        this.velocity = { x: 0, y: 0, t: performance.now() };
      } else if (this.pointers.size === 2) {
        this.tiltDrag = null;
        const [a, b] = [...this.pointers.values()];
        this.pinch = { dist: this.pointerDist(), zoom: this.zoom, mid: (a!.y + b!.y) / 2, by: this.tiltOffset, mode: this.canTilt() ? null : "pinch" };
        this.down = null;
      }
    });
    c.addEventListener("pointermove", (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      this.pointers.set(e.pointerId, cur);
      if (this.tiltDrag) {
        this.setTilt(this.tiltDrag.by, (this.tiltDrag.y - cur.y) * TILT_PER_PX);
      } else if (this.pointers.size === 2 && this.pinch) {
        // Both fingers up or down together tilt the map; spreading or closing them zooms.
        const [a, b] = [...this.pointers.values()];
        const rise = this.pinch.mid - (a!.y + b!.y) / 2;
        this.pinch.mode ??= twoFingerGesture(rise, this.pointerDist() - this.pinch.dist, true);
        if (this.pinch.mode === "tilt") this.setTilt(this.pinch.by, rise * TILT_PER_PX);
        else if (this.pinch.mode === "pinch") {
          this.zoom = clamp((this.pinch.zoom * this.pointerDist()) / this.pinch.dist, this.minZoom(), MAX_ZOOM);
          this.clampLat();
        }
      } else if (this.pointers.size === 1) {
        const dx = cur.x - prev.x;
        const dy = cur.y - prev.y;
        if (this.isRecord()) {
          const rect = c.getBoundingClientRect();
          this.pan(dx, dy, [cur.x - rect.left, cur.y - rect.top]);
        } else this.pan(dx, dy);
        if (this.theme.surface === "chalk" && !this.still()) {
          const rect = c.getBoundingClientRect();
          this.trail.push({ x: cur.x - rect.left, y: cur.y - rect.top, t: performance.now() });
          if (this.trail.length > 90) this.trail.shift();
        }
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
      if (this.tiltDrag) {
        this.tiltDrag = null;
        this.moved();
        return;
      }
      const d = this.down;
      this.down = null;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5 && performance.now() - d.t < 500) {
        this.click(e);
        return;
      }
      const recent = performance.now() - this.velocity.t < 80;
      if (recent && Math.hypot(this.velocity.x, this.velocity.y) > 0.15) this.glide();
      else {
        this.snapNext = true;
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
        PageUp: () => this.tiltStep(TILT_KEY_STEP),
        PageDown: () => this.tiltStep(-TILT_KEY_STEP),
      };
      const fn = keys[e.key];
      if (fn && (!e.key.startsWith("Page") || this.canTilt())) {
        e.preventDefault();
        fn();
      }
    });
  }

  private wheelTimer = 0;

  /** Whether the reader may tilt the camera: Map view, in a design whose picture can take it (src/map/tilt.ts). */
  private canTilt(): boolean {
    return this.mode === "2d" && tiltRange(this.theme) !== null;
  }

  /** The reader's tilt `delta` degrees from `from`, kept in the design's range. */
  private setTilt(from: number, delta: number) {
    this.tiltOffset = stepTilt(this.baseTilt(), from, delta, tiltRange(this.theme));
    this.clampLat();
  }

  /** Page Up and Page Down: tilt a step, eased like the zoom buttons. */
  private tiltStep(delta: number) {
    const from = this.tiltOffset;
    const to = stepTilt(this.baseTilt(), from, delta, tiltRange(this.theme));
    this.startAnim(250, (t) => {
      this.tiltOffset = from + (to - from) * ease(t);
      this.clampLat();
    });
  }

  /** The canvas's description for screen readers, which names tilting only where it works. */
  private label() {
    const tilt = this.canTilt() ? " Drag with the right mouse button or two fingers, or press Page Up and Page Down, to tilt." : "";
    this.canvas.setAttribute("aria-label", `Map of reported places. Drag or use the arrow keys to turn. Scroll or press plus and minus to zoom.${tilt}`);
  }

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
        if (this.pointers.size === 0) this.snapNext = true;
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
      // A frame's time can be a little before the animation started; a negative step would run the easing backwards.
      const t = clamp((now - a.start) / a.duration, 0, 1);
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
    this.landing = null;
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
      if (this.settle()) return this.moved();
      this.retune();
      this.events.onDraw?.();
      if (this.snapNext) {
        this.snapNext = false;
        this.snapToNearest();
      }
    });
  }

  /** Set when a drag or its glide has just ended: the next drawn frame, with the places where they now are, snaps. */
  private snapNext = false;

  /**
   * The nearest place within SNAP_RADIUS of the reticle glides under it (decision 125). Measured where tuning measures,
   * at the place's ground point, through the design's own camera, so it works the same on the globe, the flat map, a
   * tilted or warped picture and the record. A place already under the reticle stays put.
   */
  private snapToNearest() {
    if (this.spinning || this.anim || this.pointers.size > 0) return;
    const [cx, cy] = this.reticle();
    let best: Spot | null = null;
    let bestD = SNAP_RADIUS;
    for (const s of this.screen) {
      const d = Math.hypot((s.gx ?? s.x) - cx, (s.gy ?? s.y) - cy);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    if (!best || bestD < 1.5) return;
    this.flyTo(best.lon, best.lat, this.zoom, 320);
  }

  private retune() {
    const level = this.level();
    if (level !== this.lastLevel) {
      this.lastLevel = level;
      this.events.onLevel?.(level);
    }
    const [cx, cy] = this.reticle();
    let best: Spot | null = null;
    let bestD = TUNE_RADIUS;
    for (const s of this.screen) {
      const d = Math.hypot((s.gx ?? s.x) - cx, (s.gy ?? s.y) - cy) - s.r * 0.5;
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    let next = best ? best.indices : null;
    // Record Player: while the record plays, no place is tuned as the needle skims over it, so the panel holds still; a
    // place coming round to the needle brakes the record to rest under it.
    const playing = this.isRecord() && this.spinning;
    if (playing) {
      next = null;
      if (performance.now() - this.spinStarted > SPIN_MIN_MS && this.brakeOnPlace()) return;
    }
    const nextKey = next ? key(next) : null;
    if (this.spinning && !playing) {
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

  /** Where the reticle is on screen: the frame's centre, or Record Player's needle, which the arm swings over the record. */
  private reticle(): [number, number] {
    return this.isRecord() ? kits.vinyl!.needleAt(this.w, this.h, this.lat, this.zoom) : [this.w / 2, this.h / 2];
  }

  /**
   * Record Player: when a place on the needle's ring is within BRAKE_DEG of coming round to it, the record slows at an even
   * rate to rest with that place under the needle, the arm swinging the little way that ring is off. True when it braked.
   */
  private brakeOnPlace(): boolean {
    let at: Spot | null = null;
    let least = Infinity;
    for (const s of this.screen) {
      const turn = kits.vinyl!.turnToNeedle(this.w, this.h, this.lat, this.zoom, s.gx ?? s.x, s.gy ?? s.y, TUNE_RADIUS * 0.6);
      if (turn === null) continue;
      const ahead = turn > 358 ? 0 : turn;
      if (ahead <= kits.vinyl!.BRAKE_DEG && ahead < least) {
        at = s;
        least = ahead;
      }
    }
    if (!at) return false;
    this.stopSpin();
    const lon0 = this.lon;
    const lat0 = this.lat;
    const dl = wrap(at.lon - lon0);
    const { lon, lat } = at;
    // Slowing evenly from the record's speed to rest takes twice the distance over the speed.
    this.startAnim(Math.max(300, ((2 * Math.abs(dl)) / kits.vinyl!.recordSpin()) * 1000), (t) => {
      const k = 1 - (1 - t) * (1 - t);
      this.lon = t >= 1 ? lon : wrap(lon0 + dl * k);
      this.lat = lat0 + (lat - lat0) * k;
      this.clampLat();
    });
    this.landing = [lon, lat];
    this.events.onLand?.();
    return true;
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
    if (kind === "lilypads") {
      // Frog Pond's land: a mat of lily pads over dark water. Each is a round leaf with its slit to the stalk at the
      // centre and veins from there; pads keep a gap between them, and the few that overlap lie wholly on top with
      // their own outline. No flowers here: at this size they would read as markers (the lotuses stay in open water,
      // in the scenery). Pads near the tile's edge are drawn again one tile over, so the pattern wraps without a seam.
      const size = 220;
      const pc = document.createElement("canvas");
      pc.width = pc.height = Math.round(size * this.dpr);
      const g = pc.getContext("2d")!;
      g.scale(this.dpr, this.dpr);
      g.fillStyle = ink2;
      g.fillRect(0, 0, size, size);
      let seed = 23;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const wrap = (d: number) => d - size * Math.round(d / size);
      const pads: { x: number; y: number; r: number; rot: number; tone: number; over: boolean }[] = [];
      for (let tries = 0; tries < 4000 && pads.length < 40; tries++) {
        const r = 9 + rnd() * rnd() * 12;
        const x = rnd() * size;
        const y = rnd() * size;
        const over = pads.length > 16 && rnd() < 0.12;
        const ok = pads.every((q) => {
          const d = Math.hypot(wrap(x - q.x), wrap(y - q.y));
          // A pad laid over another sits well inside the gap, off its neighbour's middle, so it reads as a layer.
          return over ? d > Math.max(r, q.r) * 0.75 : d > r + q.r + 3;
        });
        if (ok) pads.push({ x, y, r, rot: rnd() * 360, tone: Math.floor(rnd() * 4), over });
      }
      pads.sort((a, b) => Number(a.over) - Number(b.over));
      const tones = ["#7cbb4b", "#6db244", "#8ac657", "#93b150"];
      const leaf = (r: number) => {
        const a = (14 * Math.PI) / 180;
        g.beginPath();
        g.moveTo(0, r * 0.05);
        g.lineTo(Math.sin(a) * r, -Math.cos(a) * r);
        g.arc(0, 0, r, -Math.PI / 2 + a, -Math.PI / 2 - a + Math.PI * 2);
        g.closePath();
      };
      for (const q of pads) {
        for (const ox of [-size, 0, size])
          for (const oy of [-size, 0, size]) {
            const x = q.x + ox;
            const y = q.y + oy;
            if (x < -q.r - 2 || y < -q.r - 2 || x > size + q.r + 2 || y > size + q.r + 2) continue;
            g.save();
            g.translate(x, y);
            g.save();
            g.translate(q.r * 0.12, q.r * 0.14);
            g.rotate((q.rot * Math.PI) / 180);
            leaf(q.r);
            g.fillStyle = "rgba(10,40,20,0.22)";
            g.fill();
            g.restore();
            g.rotate((q.rot * Math.PI) / 180);
            leaf(q.r);
            g.fillStyle = tones[q.tone]!;
            g.fill();
            g.strokeStyle = ink;
            g.lineWidth = 0.8;
            g.lineCap = "round";
            g.beginPath();
            for (let d = 40; d < 340; d += 40) {
              const t = (d * Math.PI) / 180;
              g.moveTo(0, 0);
              g.lineTo(Math.sin(t) * q.r * 0.82, -Math.cos(t) * q.r * 0.82);
            }
            g.stroke();
            leaf(q.r);
            g.strokeStyle = "rgba(30,72,24,0.6)";
            g.lineWidth = 1;
            g.lineJoin = "round";
            g.stroke();
            g.restore();
          }
      }
      p = this.ctx.createPattern(pc, "repeat")!;
      p.setTransform(new DOMMatrix().scale(1 / this.dpr));
      this.patterns.set(key, p);
      return p;
    }
    if (kind === "crunch") {
      // Gummy Cluster's crust: tiny irregular candy bits packed close in many bright colours (never red), each with a
      // shadow in the first ink and a glint in the second, over the gummy body that shows between them. Cut once from
      // a fixed seed into one tile, so the crust is the same over all land; bits near an edge are drawn again one
      // tile over, so it wraps without a seam.
      const size = 72;
      const pc = document.createElement("canvas");
      pc.width = pc.height = Math.round(size * this.dpr);
      const g = pc.getContext("2d")!;
      g.scale(this.dpr, this.dpr);
      let seed = 41;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const wrap = (d: number) => d - size * Math.round(d / size);
      const colours = ["#ff4f9e", "#a46bff", "#c9a4ff", "#ff9a2e", "#ffd93b", "#23c9b5", "#7fe3ff", "#9be04a", "#fff3fa", "#ff7ab8"];
      const bits: { x: number; y: number; r: number; pts: [number, number][]; c: string }[] = [];
      for (let tries = 0; tries < 9000 && bits.length < 360; tries++) {
        const r = 1.8 + rnd() * rnd() * 2.8;
        const x = rnd() * size;
        const y = rnd() * size;
        if (!bits.every((q) => Math.hypot(wrap(x - q.x), wrap(y - q.y)) > (r + q.r) * 0.86)) continue;
        const n = 5 + Math.floor(rnd() * 3);
        const turn = rnd() * Math.PI * 2;
        const pts = Array.from({ length: n }, (_, i): [number, number] => {
          const a = turn + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
          const k = r * (0.72 + rnd() * 0.42);
          return [Math.cos(a) * k, Math.sin(a) * k];
        });
        bits.push({ x, y, r, pts, c: colours[Math.floor(rnd() * colours.length)]! });
      }
      const bit = (b: (typeof bits)[number], dx: number, dy: number) => {
        g.beginPath();
        b.pts.forEach(([px, py], i) => (i ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy)));
        g.closePath();
      };
      for (const pass of [0, 1, 2]) {
        for (const b of bits) {
          for (const ox of [-size, 0, size])
            for (const oy of [-size, 0, size]) {
              const x = b.x + ox;
              const y = b.y + oy;
              if (x < -b.r - 2 || y < -b.r - 2 || x > size + b.r + 2 || y > size + b.r + 2) continue;
              if (pass === 0) {
                bit(b, x + 0.5, y + 0.7);
                g.fillStyle = ink;
                g.fill();
              } else if (pass === 1) {
                bit(b, x, y);
                g.fillStyle = b.c;
                g.fill();
              } else if (b.r > 1.9) {
                g.beginPath();
                g.ellipse(x - b.r * 0.32, y - b.r * 0.36, b.r * 0.34, b.r * 0.2, -0.6, 0, Math.PI * 2);
                g.fillStyle = ink2;
                g.fill();
              }
            }
        }
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

  /** The camera's tilt now: the design's, with the reader's change on top. */
  tiltAngle(): number {
    return readerTilt(this.baseTilt(), this.tiltOffset, tiltRange(this.theme));
  }

  /** The design's own tilt: fixed, or with `tiltOut` flatter when zoomed out (Pop-up Book, decision 76). */
  private baseTilt(): number {
    const t = this.theme;
    if (!t.tiltOut) return t.tilt ?? 0;
    const [flat, by] = t.tiltOut;
    const lo = t.tiltMinZoom ?? 1.8;
    const k = clamp((this.zoom - lo) / Math.max(0.01, by - lo), 0, 1);
    return flat + ((t.tilt ?? flat) - flat) * (1 - (1 - k) * (1 - k));
  }

  makeCam(tilt: number): Cam {
    const a = tilt / DEG;
    return { cx: this.w / 2, cy: this.h / 2, sin: Math.sin(a), cos: Math.cos(a), d: this.h * (this.theme.tiltEye ?? 1), far: this.theme.tiltFar ?? 0.5 };
  }

  /** A point on the flat map, raised `lift` pixels, as the tilted camera sees it, with its perspective scale. */
  tp(x: number, y: number, lift: number, cam: Cam): [number, number, number] {
    const v = y - cam.cy;
    const s = cam.d / Math.max(cam.d * 0.25, cam.d - v * cam.sin);
    return [cam.cx + (x - cam.cx) * s, cam.cy + v * cam.cos * s - lift * s, s];
  }

  tiltStream(out: GeoStream, cam: Cam): GeoStream {
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
    const scenes = this.sceneKit();
    if (scenes) return scenes.scenePlace(proj, lon, lat);
    if (this.isFold()) return kits.fold!.foldPlace(this.foldCamera(), lon, lat);
    // The South Pole is the record's whole edge; a place there sits where the needle reaches it.
    if (this.isRecord() && lat < kits.vinyl!.NEEDLE_LAT[0]) [lon, lat] = [this.lon, kits.vinyl!.NEEDLE_LAT[0]];
    const p = proj([lon, lat]);
    if (!p) return null;
    const m = this.terrainNow;
    const hgt = m ? kits.lowPoly!.heightAt(m, lon, lat) * this.liftPx : 0;
    if (this.cam) {
      const [x, y, s] = this.tp(p[0], p[1], hgt, this.cam);
      if (this.warp) {
        const [wx, wy] = this.warp.fwd(x, y);
        return { x: wx, y: wy, s };
      }
      return { x, y, s };
    }
    if (this.warp) {
      const [wx, wy] = this.warp.fwd(p[0], p[1]);
      return { x: wx, y: wy, s: 1 };
    }
    if (m && this.mode === "3d") {
      const [cx, cy] = proj.translate();
      const k = 1 + hgt / proj.scale();
      return { x: cx + (p[0] - cx) * k, y: cy + (p[1] - cy) * k, s: 1 };
    }
    return { x: p[0], y: p[1], s: 1 };
  }

  liftPx = 0;

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

  private isFold(): boolean {
    return this.theme.surface === "fold" && !!kits.fold;
  }

  /** Record Player's Globe view, where the world is a record under the tonearm (src/map/vinyl.ts). */
  private isRecord(): boolean {
    return this.theme.surface === "vinyl" && this.mode === "3d" && !!kits.vinyl;
  }

  private foldHide = false;
  private foldRestKey: [ViewMode, number, number, number] = ["2d", NaN, NaN, NaN];

  /**
   * Folding Cube's camera at rest for the current view, the one places are placed and tuned through. It is asked once
   * per place, tens of thousands of times a frame with local stories loaded, so the check is a few numbers, not a string.
   */
  private foldCamera(): Camera {
    const k = kits.fold!.foldBase(this.mode, this.w, this.h) * this.zoom;
    const c = this.foldRest;
    const key = this.foldRestKey;
    if (!c || key[0] !== this.mode || key[1] !== this.lon || key[2] !== this.lat || key[3] !== k || c.w !== this.w || c.h !== this.h) {
      this.foldRest = new kits.fold!.Camera(kits.fold!.restingPose(this.mode, this.lon, this.lat, k), this.w, this.h);
      this.foldRestKey = [this.mode, this.lon, this.lat, k];
    }
    return this.foldRest!;
  }

  /**
   * Folding Cube (src/map/fold.ts): the world on a cube, or on its net laid flat. The opening plays once per page load
   * and the fold between views at each switch, never for reduced motion or in a hidden tab, and a click or a key ends
   * the opening at once. Each runs on animation frames, which the browser holds while the tab is hidden.
   */
  private renderFold() {
    const { ctx, w, h, theme: t } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.lastDraw = performance.now();
    this.warp = null;
    this.cam = null;
    this.terrainNow = null;
    const now = performance.now();
    if (!this.foldIntroPlayed) {
      this.foldIntroPlayed = true;
      if (!this.still() && !document.hidden) {
        const skip = () => {
          if (!this.foldIntro) return;
          this.foldIntro.off();
          this.foldIntro = null;
          this.request();
        };
        const off = () => {
          window.removeEventListener("pointerdown", skip, true);
          window.removeEventListener("keydown", skip, true);
        };
        window.addEventListener("pointerdown", skip, true);
        window.addEventListener("keydown", skip, true);
        this.foldIntro = { start: now, off };
      }
    }
    const rest = this.foldCamera();
    let pose = rest.pose;
    if (this.foldTurn) {
      const from = this.foldTurn.from;
      const t = (now - this.foldTurn.start) / kits.fold!.TURN_MS;
      if (t >= 1 || this.still() || from === this.mode) this.foldTurn = null;
      else pose = kits.fold!.turnPose(kits.fold!.restingPose(from, this.lon, this.lat, kits.fold!.foldBase(from, w, h) * this.zoom), pose, t);
    }
    if (this.foldIntro) {
      const ms = now - this.foldIntro.start;
      if (ms >= kits.fold!.INTRO_MS || this.still()) {
        this.foldIntro.off();
        this.foldIntro = null;
      } else pose = kits.fold!.introPose(pose, ms, w, h);
    }
    const moving = !!(this.foldIntro || this.foldTurn);
    const shown = moving ? new kits.fold!.Camera(pose, w, h) : rest;
    // The finer basemap once a face is large on screen (a face's half-width spans about 45 degrees).
    const map = (shown.pose.k * 1.3 >= DETAIL_SCALE ? this.high : this.low) ?? this.low ?? this.high;
    kits.fold!.drawFold({ ctx, w, h, theme: t, map, zoom: this.zoom, cam: shown, globe: !moving && this.mode === "3d" });
    const proj = this.projection();
    if (!moving) this.drawArcs(geoPath(proj, ctx), proj);
    this.foldHide = moving;
    this.drawDots(proj);
    this.foldHide = false;
    if (moving) this.request();
  }

  private render() {
    if (this.theme.scene) return void this.sceneKit()?.renderScene();
    if (this.isFold()) return this.renderFold();
    const { ctx, w, h, theme: t } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.lastDraw = performance.now();
    // A warp bends the whole picture (decision 75); the picture tube's curve is Map view's only.
    const wk = t.warp && !(t.warp === "barrel" && this.mode === "3d") ? t.warp : null;
    if (wk === "wobble") {
      // Noodle Bowl: the broth sways after a drag or a zoom and settles, so the warp exists only while it does.
      this.warp = surfaceOf("soup")?.wobble?.(this.cacheOf("soup"), performance.now(), this.lon, this.lat, this.zoom, this.baseScale * this.zoom, w, h, this.still()) ?? null;
      this.warpFor = "";
    } else if (!wk) this.warp = null;
    else if (this.warp?.kind !== wk || this.warpFor !== `${w}x${h}:${this.mode}`) {
      this.warp = makeWarp(wk, w, h, this.mode === "3d");
      this.warpFor = `${w}x${h}:${this.mode}`;
    }
    const proj = this.projection();
    const R = proj.scale();
    // The tilted camera applies to the flat map; the globe is already a solid seen in perspective.
    const angle = this.mode === "2d" ? this.tiltAngle() : 0;
    const cam = this.mode === "2d" && (t.tilt || angle > 0) ? this.makeCam(angle) : null;
    this.cam = cam;
    this.terrainNow = null;
    this.liftPx = R * LIFT;
    const wp = this.warp;
    const view = wp
      ? { stream: (out: GeoStream) => proj.stream(cam ? this.tiltStream(warpStream(out, wp), cam) : warpStream(out, wp)) }
      : cam
        ? { stream: (out: GeoStream) => proj.stream(this.tiltStream(out, cam)) }
        : proj;
    const path = geoPath(view as GeoProjection, ctx);
    // Detail follows the map's size on screen, never whether it is being dragged, so coasts, lakes and rivers
    // don't change shape when the map is touched or let go (decision 42). The whole world at once gets the light
    // file, where the finer one adds nothing visible and drags slowly; zooming in switches to the fine one.
    const map = this.detailMap(proj, (proj.scale() >= DETAIL_SCALE ? this.high : this.low) ?? this.low ?? this.high, cam, t);

    if (t.surface && map) {
      // Couch Potato sets its buttons inside the channel tile in Map view, so the page needs to know which is showing.
      if ((t.surface === "gloss" || t.surface === "alien") && this.container.dataset.view !== this.mode) this.container.dataset.view = this.mode;
      // Night Drive, Cross Stitch and Rose Window draw land and sea their own way (decision 70). Places, arcs and
      // tuning are the same as in every design.
      const drawn = this.drawSurface(proj, cam, view, map, t);
      const framed = typeof drawn === "object" ? drawn : undefined;
      const again = typeof drawn === "number" ? drawn : (framed?.next ?? 0);
      kits.decor?.drawDecor(ctx, proj, t, this.mode, [this.lon, this.lat]);
      if (framed?.clip) {
        ctx.save();
        ctx.clip(framed.clip);
        this.drawArcs(path, proj);
        ctx.restore();
      } else this.drawArcs(path, proj);
      this.drawDots(proj, framed);
      framed?.over?.();
      this.ambient();
      // Decision 76: a handmade design with its own motion asks for its next frame, never while the tab is hidden or
      // for readers who ask for reduced motion.
      clearTimeout(this.handTimer);
      if (again && !this.still() && !document.hidden) this.handTimer = window.setTimeout(() => this.request(), again);
      return;
    }

    // Old Realm's round minimap: Map view is drawn inside a circle, and the page's ring goes around it.
    const porthole = t.minimap && this.mode === "2d" ? minimapFrame(w, h) : null;
    if (t.minimap && this.container.dataset.view !== this.mode) this.container.dataset.view = this.mode;
    if (porthole) {
      ctx.save();
      ctx.clip(porthole.clip!);
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

    if (t.lowPoly && kits.lowPoly) {
      // Water: a soft low-resolution texture that moves with the world.
      ctx.save();
      ctx.globalCompositeOperation = "soft-light";
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = kits.lowPoly.worldTexture(this, proj, 1.6);
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
    if (t.scenery) kits.scenery?.drawSceneryUnder(scene);

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
    if (map && t.lowPoly) kits.lowPoly?.drawLowPoly(this, proj, t);

    // Globe rim / sheet edge
    outline();
    ctx.strokeStyle = t.coast;
    ctx.lineWidth = this.mode === "3d" ? 1 : 1.2;
    ctx.stroke();
    if (this.mode === "2d" && t.neatline && !cam) {
      // A printed chart's double frame around the whole sheet.
      const [[x0, y0], [x1, y1]] = path.bounds(SPHERE);
      ctx.strokeStyle = t.coast;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x0 - 7, y0 - 7, x1 - x0 + 14, y1 - y0 + 14);
      ctx.lineWidth = 0.6;
      ctx.strokeRect(x0 - 11, y0 - 11, x1 - x0 + 22, y1 - y0 + 22);
    }

    kits.decor?.drawDecor(ctx, proj, t, this.mode, [this.lon, this.lat]);
    if (t.scenery) kits.scenery?.drawScenery({ ...scene, land: map && !t.lowPoly ? this.landPath : null });
    this.drawArcs(path, proj);
    this.drawDots(proj, porthole ?? undefined);
    if (porthole) ctx.restore();
  }

  /**
   * A design with motion of its own (Aquarium, Lava Lamp; src/map/ambient.ts) asks for its next frame a little
   * later, at a gentle rate, and never for reduced motion; a frame the reader causes by dragging simply comes
   * first. The browser holds animation frames in a hidden tab, so the motion stops there, and the frame asked for
   * last starts it again when the tab shows.
   */
  private ambient() {
    clearTimeout(this.ambientTimer);
    const ms = ambientDelay(this.theme);
    if (ms) this.ambientTimer = window.setTimeout(() => this.request(), ms);
  }

  /** What a surface keeps between frames, made the first time it is drawn. */
  private caches = new Map<string, unknown>();
  private cacheOf(name: string): unknown {
    let c = this.caches.get(name);
    const make = surfaceOf(name)?.make;
    if (c === undefined && make) this.caches.set(name, (c = make()));
    return c;
  }

  private scenes?: Scenes;
  /** The scene designs' renderer (src/map/scene-view.ts), once their entry has registered it. */
  private sceneKit(): Scenes | null {
    if (!this.theme.scene || !kits.scenes) return null;
    return (this.scenes ??= kits.scenes.createScenes(this));
  }

  /** The land and ice of `base` read back as tests, kept until the basemap changes (the terrain meshes go with them). */
  rastersFor(base: Basemap) {
    if (!this.rasters || this.rasters.base !== base) {
      this.rasters = { base, isLand: raster(base.land), isIce: raster(base.ice) };
      this.meshes.clear();
    }
    return this.rasters;
  }

  private drawSurface(proj: GeoProjection, cam: Cam | null, view: { stream(out: GeoStream): GeoStream }, map: Basemap, t: Theme): SurfaceResult | number | void {
    const base = this.low ?? this.high ?? map;
    const rasters = this.rastersFor(base);
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
      mapId: this.mapId(map),
      low: base,
      relief: this.relief,
      isLand: rasters.isLand,
      isIce: rasters.isIce,
      now: performance.now(),
      still: this.still(),
      warp: this.warp,
      time: this.still() ? 0 : performance.now(),
      trail: this.trail,
      anchors: this.anchors,
      tuned: !!this.tuned,
    };
    // The design's own entry registered how it draws (src/designs/<id>.ts); until it has, nothing design-specific is drawn.
    const surface = surfaceOf(t.surface!);
    return surface?.draw(f, this.cacheOf(t.surface!));
  }

  private pictures = new Map<string, HTMLImageElement>();

  /** A design's land picture (`landImage`), loaded once; null until it has loaded, and a redraw when it has. */
  private landPicture(src: string): HTMLImageElement | null {
    let im = this.pictures.get(src);
    if (!im) {
      im = new Image();
      im.decoding = "async";
      im.onload = () => this.request();
      im.src = `${import.meta.env.BASE_URL}${src}`;
      this.pictures.set(src, im);
    }
    return im.complete && im.naturalWidth > 0 ? im : null;
  }

  drawMap(path: ReturnType<typeof geoPath>, proj: GeoProjection, map: Basemap, t: Theme) {
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
    // The 10m coast has a segment every pixel or two. The wide bands along it (ripples, shallows) can't show that, and a
    // stroke costs by its segments, so they take a copy with a point at least 2 pixels apart.
    let wide = coast;
    if (this.detailing) {
      wide = new Path2D();
      const sparse = sparseContext(wide, 2);
      geoPath(seen, sparse)(map.coast);
      sparse.end();
    }
    const lines = t.waterlines;
    if (lines > 0) {
      ctx.lineJoin = "round";
      const gap = 3.2;
      for (let i = lines; i >= 1; i--) {
        ctx.lineWidth = i * gap * 2;
        ctx.strokeStyle = t.waterline;
        ctx.stroke(wide);
        ctx.lineWidth = i * gap * 2 - 1.3;
        ctx.strokeStyle = t.ocean;
        ctx.stroke(wide);
      }
    }

    if (t.shallows) {
      ctx.lineJoin = "round";
      ctx.lineWidth = 12;
      ctx.strokeStyle = t.shallows;
      ctx.stroke(wide);
    }

    ctx.fillStyle = t.land;
    ctx.fill(land);
    const picture = t.landImage ? this.landPicture(t.landImage) : null;
    if (picture) {
      // Cover the frame (Map) or the sphere's disc (Globe), cropping the picture's longer side, never stretching it.
      const globe = this.mode === "3d";
      const R = proj.scale();
      const [cx, cy] = proj.translate();
      const bw = globe ? 2 * R : this.w;
      const bh = globe ? 2 * R : this.h;
      const k = Math.max(bw / picture.naturalWidth, bh / picture.naturalHeight);
      const pw = picture.naturalWidth * k;
      const ph = picture.naturalHeight * k;
      ctx.save();
      ctx.clip(land);
      ctx.drawImage(picture, (globe ? cx : this.w / 2) - pw / 2, (globe ? cy : this.h / 2) - ph / 2, pw, ph);
      ctx.restore();
    }
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

    // A picture in the land carries its own light and shade, so the relief would only scratch over it.
    if (this.relief && !t.landImage) this.drawRelief(proj, t);

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

  drawArcs(path: ReturnType<typeof geoPath>, proj: GeoProjection) {
    if (!this.arcs) return;
    const { ctx, theme: t } = this;
    ctx.save();
    ctx.strokeStyle = t.arc;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    if (this.isFold()) {
      // Across the cube's faces shown, broken where a face turns away or the net is cut open.
      const p = new Path2D();
      for (const to of this.arcs.to) kits.fold!.foldArc(this.foldCamera(), geoInterpolate(this.arcs.from, to), p);
      ctx.stroke(p);
    } else for (const to of this.arcs.to) path({ type: "LineString", coordinates: [this.arcs.from, to] });
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

  /**
   * The places that may be on screen. On the globe, whole cells on the far side are passed over, and with the plain
   * camera (no tilt, warp, scene or terrain) so are cells whose every point is off screen: an orthographic globe
   * never draws two points further apart than their angle times its radius.
   */
  private *candidates(proj: GeoProjection): Iterable<Dot> {
    // A cube's face can show places further round than a globe's rim, so Folding Cube asks of every place.
    if (this.mode !== "3d" || this.isFold() || this.isRecord()) {
      yield* this.dots;
      return;
    }
    const plain = !this.cam && !this.warp && !this.theme.scene && !this.terrainNow;
    const reach = proj.scale() * DOT_CELL_RADIUS + 24;
    for (const c of this.dotCells) {
      // Every point of the cell is further round than the edge of the globe's face.
      if (this.cosFromCenter(c.lon, c.lat) <= Math.sin(0.03 - DOT_CELL_RADIUS)) continue;
      if (plain) {
        const p = proj([c.lon, c.lat]);
        if (p && (p[0] < -reach || p[1] < -reach || p[0] > this.w + reach || p[1] > this.h + reach)) continue;
      }
      yield* c.dots;
    }
  }

  drawDots(proj: GeoProjection, framed?: SurfaceResult | void) {
    const { ctx, theme: t } = this;
    // Smaller screens get smaller dots so a phone-sized world isn't all ink.
    const screenK = clamp(Math.min(this.w, this.h) / 720, 0.6, 1);
    const zoomK = (0.85 + 0.15 * Math.min(this.zoom, 4)) * screenK;
    const level = this.level();

    // Project the places shown at this zoom, then merge those that would overlap on screen.
    // Largest first, so a merged dot sits on its busiest place.
    const shown: { d: Dot; x: number; y: number; s: number }[] = [];
    for (const d of this.candidates(proj)) {
      if (d.tier > level || !this.visible(d.lon, d.lat)) continue;
      const p = this.placeAt(proj, d.lon, d.lat);
      if (!p) continue;
      // Beyond the tilted camera's draw distance the map is haze; its places are reached by dragging closer.
      if (this.cam && p.s < this.cam.far) continue;
      if (p.x < -20 || p.y < -20 || p.x > this.w + 20 || p.y > this.h + 20) continue;
      // A design that frames the map (a radar scope, a picture tube, a big screen) shows places inside it only.
      if (framed?.inside && !framed.inside(p.x, p.y)) continue;
      shown.push({ d, x: p.x, y: p.y, s: p.s });
    }
    // Heaviest first, then most reports, then the list's order, each place as one number sorted natively: a day with
    // tens of thousands of towns can put ten thousand places on screen at the closest zoom (decision 78). The low
    // bits carry the place's position in `shown`.
    const order = new Float64Array(shown.length);
    shown.forEach((e, i) => {
      order[i] = (((5 - clamp(e.d.weight, 1, 5)) * 1024 + (1023 - clamp(e.d.count, 0, 1023))) * 2 ** 21 + (e.d.index % 2 ** 21)) * 2 ** 17 + i;
    });
    order.sort();
    const spots: Spot[] = [];
    const merge = MERGE_PX * screenK;
    const merge2 = merge * merge;
    // Spots bucketed by screen cell in flat arrays, each cell a chain of its spots, so a zoomed-in view of ten
    // thousand places merges in one pass. The earliest spot within reach wins, as a search through the whole list
    // would find. Places are within 20 pixels of the frame (above), so the grid covers it with a cell to spare.
    const cols = Math.ceil((this.w + 40) / merge) + 2;
    const rows = Math.ceil((this.h + 40) / merge) + 2;
    const head = new Int32Array(cols * rows).fill(-1);
    const next: number[] = [];
    for (const o of order) {
      const { d, x, y } = shown[o % 2 ** 17]!;
      const cx = Math.floor((x + 20) / merge) + 1;
      const cy = Math.floor((y + 20) / merge) + 1;
      let first = -1;
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
          const c = (cy + j) * cols + cx + i;
          if (c < 0 || c >= head.length) continue;
          for (let k = head[c]!; k >= 0; k = next[k]!) {
            if (first >= 0 && k > first) continue;
            const dx = spots[k]!.x - x;
            const dy = spots[k]!.y - y;
            if (dx * dx + dy * dy < merge2) first = k;
          }
        }
      const near = spots[first];
      if (near) {
        near.indices.push(d.index);
        near.count += d.count;
        near.weight = Math.max(near.weight, d.weight);
        near.fresh ||= d.fresh;
      } else {
        const c = cy * cols + cx;
        if (c >= 0 && c < head.length) {
          next[spots.length] = head[c]!;
          head[c] = spots.length;
        }
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
    // While Folding Cube opens or folds, its places are tuned where they will rest but not drawn on moving faces.
    if (this.foldHide) return;
    ctx.save();
    if (framed?.clip) ctx.clip(framed.clip);
    framed?.under?.(spots);
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
    /** The outer ring `gap` outside a marker (a circle round Pirate's X, marks.ts). */
    const ringShape = (x: number, y: number, r: number, gap: number) => {
      if (t.dotShape === "square") return shape(x, y, r + gap);
      cur = markRing2D(t.dotShape, r, gap);
      ox = x;
      oy = y;
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
      if (t.dotShape === "cube" && !hollow) {
        // A little glossy cube (Folding Cube): a lit top, a shaded right face and its edges inside the outline.
        const c = cubeFaces2D(r);
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.translate(x, y);
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.fill(c.top);
        ctx.fillStyle = "rgba(20,8,60,0.3)";
        ctx.fill(c.right);
        ctx.lineWidth = Math.max(0.7, r * 0.12);
        ctx.lineJoin = "round";
        ctx.strokeStyle = t.dotStroke;
        ctx.globalAlpha = 0.55;
        ctx.stroke(c.edges);
        ctx.restore();
      }
      if (t.dotShape === "bean") {
        // Tiramisu's coffee bean: a roasted sheen on a filled bean, and the crease down its middle on every bean, pale
        // on a filled one and in the ink on a hollow one, so the hollow outline still reads as a bean.
        ctx.save();
        ctx.shadowBlur = 0;
        if (!hollow) shadeShape(x, y, r, [[0, "rgba(255,240,220,0.5)"], [0.4, "rgba(255,240,220,0)"], [1, "rgba(0,0,0,0.22)"]]);
        if (r >= 2.5) {
          ctx.translate(x, y);
          ctx.lineWidth = Math.max(0.7, r * (hollow ? 0.13 : 0.17));
          ctx.lineCap = "round";
          ctx.strokeStyle = hollow ? ink : t.dotStroke;
          ctx.globalAlpha = hollow ? 0.85 : 0.8;
          ctx.stroke(beanCrease2D(r));
        }
        ctx.restore();
      }
      if (t.dotShape === "buoy" && r >= 3) {
        // Lobster's toggle buoy: the painted band across the float, pale on a filled one and in the ink on a hollow one.
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.translate(x, y);
        ctx.lineWidth = Math.max(1, r * 0.3);
        ctx.strokeStyle = hollow ? ink : t.dotStroke;
        ctx.stroke(buoyBand2D(r));
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
      if (t.dotShape === "loop" && !hollow && r >= 3.5) {
        // Chalk or pencil scribbled back and forth inside the drawn circle (decision 76). The symbol is still a
        // filled mark; the scribble is only its texture.
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.62, y + r * 0.1);
        ctx.lineTo(x - r * 0.05, y - r * 0.62);
        ctx.lineTo(x - r * 0.35, y + r * 0.5);
        ctx.lineTo(x + r * 0.4, y - r * 0.45);
        ctx.lineTo(x + r * 0.12, y + r * 0.62);
        ctx.lineTo(x + r * 0.62, y - r * 0.02);
        ctx.lineWidth = Math.max(0.7, r * 0.1);
        ctx.lineJoin = "round";
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = t.dotStroke;
        ctx.stroke();
        ctx.restore();
      }
      if (t.dotShape === "slice" && !hollow && r >= 3.5) {
        // Noodle Bowl: a slice's cut face, a pale ring inside the scalloped rim. Only texture; the symbol is a filled mark.
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(0.8, r * 0.14);
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = t.dotStroke;
        ctx.stroke();
        ctx.restore();
      }
      ctx.lineWidth = hollow ? 1.6 : 1.2;
      ctx.strokeStyle = hollow ? ink : t.dotStroke;
      strokeShape();
      if (t.surface === "zine" && kits.zine) {
        // Zine: the blue pass prints each mark's outline a little off register from its pink or yellow.
        const [dx, dy] = kits.zine.misregister(this.w, this.h);
        ctx.save();
        ctx.globalCompositeOperation = "multiply";
        ctx.translate(dx * 0.8, dy * 0.8);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = kits.zine.BLUE;
        shape(x, y, r + (hollow ? 0 : 0.6));
        strokeShape();
        ctx.restore();
      }
      const ringGap = s.weight >= 4 ? 2.6 : 0;
      if (s.weight >= 4) {
        ringShape(x, y, r, ringGap);
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
        ringShape(x, y, r, ringGap + 2.6);
        ctx.lineWidth = 0.9;
        ctx.strokeStyle = t.dot;
        strokeShape();
        ctx.restore();
      }
      if (s.indices.some((i) => this.pinned.has(i))) {
        ctx.beginPath();
        if (t.pinRing) ctx.arc(x, y, r + 7, 0, Math.PI * 2);
        else ctx.rect(x - r - 3.5, y - r - 3.5, (r + 3.5) * 2, (r + 3.5) * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = t.tuned;
        // A ring of fine dots, so it reads as neither the importance ring nor a highlight.
        if (t.pinRing) ctx.setLineDash([1.5, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
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
    ctx.restore();
  }

}
