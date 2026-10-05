// The scene designs' renderer (decision 71): Nightclub, Poolside, Snow Globe and Rave have a camera and moving light of
// their own, drawn as a still picture kept off screen plus a few animated extras (src/map/scenes.ts has the pieces).
// It was part of the map view and lives here so its code reaches a visitor only with one of those designs
// (src/designs/club.ts and the others register it). It reaches into the view for the frame it draws into, the
// camera and the basemap; the view calls `renderScene`, `scenePlace` and `sceneMag` and nothing else.
import { geoEquirectangular, geoPath, type GeoProjection, type GeoStream } from "d3-geo";
import type { Theme } from "../themes.ts";
import type { Basemap, Relief } from "./basemap.ts";
import {
  ballGlints,
  buildBall,
  buildFloor,
  causticFrames,
  css,
  drawClubRoom,
  drawLasers,
  drawPoolNight,
  drawPoolRipples,
  drawSpecks,
  drawSpotlights,
  FLOOR_LEVELS,
  floorColor,
  hexRGB,
  lensOf,
  lensPoint,
  mix,
  drawRaveHaze,
  drawRaveLasers,
  drawRaveRoom,
  ledTile,
  raveBand,
  Snow,
  snowFloor,
  warped,
  type Ball,
  type Floor,
  type RGB,
  type Warp as SceneWarp,
} from "./scenes.ts";
import { clamp, DEG, DETAIL_SCALE, GRATICULE, SPHERE, wrap, type Cam, type MapView } from "./view.ts";

/**
 * Which half-degree cells hold any land or touch it, read back from a small plate carrée drawing of the land with
 * its coast thickened: a generous test of whether a box of longitude and latitude may hold land, for Nightclub's
 * tiles and facets, whose exact shape the coast then cuts. `near` says whether a point is on or beside land.
 */
function landReach(fc: Basemap["land"]): { box: (w: number, s: number, e: number, n: number) => boolean; near: (lon: number, lat: number) => boolean } {
  const W = 720;
  const H = 360;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  const proj = geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]).precision(0.2);
  g.beginPath();
  geoPath(proj, g)(fc);
  g.fillStyle = g.strokeStyle = "#fff";
  g.lineWidth = 2;
  g.fill();
  g.stroke();
  const px = g.getImageData(0, 0, W, H).data;
  const cells = new Uint8Array(W * H);
  for (let i = 0; i < cells.length; i++) cells[i] = px[i * 4 + 3]! > 0 ? 1 : 0;
  const row = (lat: number) => Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
  const col = (lon: number) => ((Math.floor(((lon + 180) / 360) * W) % W) + W) % W;
  const box = (w: number, s: number, e: number, n: number) => {
    const x0 = Math.floor(((w + 180) / 360) * W), x1 = Math.floor(((e + 180) / 360) * W - 1e-9);
    for (let y = row(n); y <= row(s); y++)
      for (let x = x0; x <= Math.max(x0, x1); x++) if (cells[y * W + (((x % W) + W) % W)]) return true;
    return false;
  };
  return { box, near: (lon, lat) => cells[row(lat) * W + col(lon)] === 1 };
}

/** The renderer for one map view. */
export class Scenes {
  constructor(private v: MapView) {}

  // ---- Scenes: designs with their own camera and moving light (decision 71, src/map/scenes.ts) ---------------------

  /**
   * The still picture of the current view, drawn once off screen and repainted under the moving light, so an idle
   * frame costs a copy and a few extras rather than the whole map. `back` holds what stands behind the moving
   * light (the club room, the pool at night) and depends only on the frame's size.
   */
  private sceneCache: {
    key: string;
    backKey: string;
    map?: Basemap;
    relief?: Relief;
    front: HTMLCanvasElement;
    back: HTMLCanvasElement;
    ball?: Ball;
    floor?: Floor;
  } | null = null;
  /** The camera after the projection (tilt, lens, ripple or bob) for this frame, shared by land, arcs and dots. */
  private sceneWarp: SceneWarp | null = null;
  private sceneTimer = 0;
  private sceneLast: { lon: number; lat: number; t: number } | null = null;
  private sceneWatching = false;
  private sceneMotion?: MediaQueryList;
  private snow: Snow | null = null;
  private caustics: CanvasPattern[] | null = null;
  private poolTiles?: CanvasPattern;

  /** How much the scene's camera enlarges the centre, so a drag moves the map as far as the finger. */
  sceneMag(): number {
    return this.v.theme.scene === "snow" && this.v.mode === "2d" ? 1 + lensOf(1, 1).a : 1;
  }

  /** A place through the scene's camera; null past the dance floor's draw distance or outside the window's glass. */
  scenePlace(proj: GeoProjection, lon: number, lat: number): { x: number; y: number; s: number } | null {
    const p = proj([lon, lat]);
    if (!p) return null;
    if (this.v.theme.scene === "rave") {
      // Rave: behind the DJ booth, or up in the rig above the LED wall, a place is out of sight.
      const band = raveBand(this.v.h);
      return p[1] > this.v.h - band || (this.v.mode === "2d" && p[1] < band) ? null : { x: p[0], y: p[1], s: 1 };
    }
    const f = this.sceneWarp;
    if (!f) return { x: p[0], y: p[1], s: 1 };
    const q = f(p[0], p[1]);
    if (this.v.cam && q[2] < SCENE_CUTOFF) return null;
    if (this.v.theme.scene === "snow" && this.v.mode === "2d") {
      const L = lensOf(this.v.w, this.v.h);
      if (((q[0] - L.cx) / L.rx) ** 2 + ((q[1] - L.cy) / L.ry) ** 2 > 0.97) return null;
    }
    return { x: q[0], y: q[1], s: this.v.cam ? q[2] : 1 };
  }

  /** Where the tilted dance floor ends in haze: the screen height of the draw distance. */
  private horizonY(cam: Cam): number {
    const v = -(cam.d / SCENE_CUTOFF - cam.d) / cam.sin;
    return cam.cy + v * cam.cos * SCENE_CUTOFF;
  }

  private sceneCanvas(c?: HTMLCanvasElement): HTMLCanvasElement {
    const cv = c ?? document.createElement("canvas");
    const W = Math.round(this.v.w * this.v.dpr), H = Math.round(this.v.h * this.v.dpr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    return cv;
  }

  /** Paint into an off-screen canvas with the usual drawing code, which draws on this.v.ctx. */
  private paintInto(c: HTMLCanvasElement, draw: (g: CanvasRenderingContext2D) => void) {
    const g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.setTransform(this.v.dpr, 0, 0, this.v.dpr, 0, 0);
    const main = this.v.ctx;
    this.v.ctx = g;
    try {
      draw(g);
    } finally {
      this.v.ctx = main;
    }
  }

  private sceneLand?: { base: Basemap; test: ReturnType<typeof landReach> };

  /**
   * Nightclub's land: the finer basemap whenever it has loaded, so every strait it has shows between the lit tiles
   * and mirrors; what may hold land; and the places it misses, whose tile or facet is lit whole.
   */
  private clubLand(anchors: [number, number][]) {
    const map = this.v.high ?? this.v.low;
    if (!map) return { map, box: () => false, stranded: anchors };
    if (this.sceneLand?.base !== map) this.sceneLand = { base: map, test: landReach(map.land) };
    const { box, near } = this.sceneLand.test;
    return { map, box, stranded: anchors.filter(([lon, lat]) => !near(lon, lat)) };
  }

  /** Ask for the next frame of moving light, twelve a second, and none while the tab is hidden. */
  private scheduleScene() {
    if (this.sceneTimer || document.hidden) return;
    this.sceneTimer = window.setTimeout(() => {
      this.sceneTimer = 0;
      if (this.v.theme.scene && !document.hidden) this.v.request();
    }, 1000 / SCENE_FPS);
  }

  renderScene() {
    const { w, h, theme: t } = this.v;
    const kind = t.scene!;
    const globe = this.v.mode === "3d";
    this.sceneMotion ??= matchMedia("(prefers-reduced-motion: reduce)");
    // With reduced motion every light holds still at one moment, and the snow lies settled.
    const still = this.sceneMotion.matches;
    const now = still ? 9 : performance.now() / 1000;
    // The page frames some scenes by view (the pool's edge in Map view), so it needs to know which is showing.
    if (this.v.container.dataset.view !== this.v.mode) this.v.container.dataset.view = this.v.mode;
    // Rave: the DJ booth (chrome in src/ui/extras.ts) is as tall as the rig the canvas draws above the wall.
    const band = kind === "rave" ? raveBand(h) : 0;
    if (band && this.v.container.style.getPropertyValue("--rave-band") !== `${band}px`) this.v.container.style.setProperty("--rave-band", `${band}px`);
    if (!this.sceneWatching) {
      this.sceneWatching = true;
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && this.v.theme.scene) this.v.request();
      });
    }
    const proj = this.v.projection();
    const R = proj.scale();
    const [cx, cy] = proj.translate();
    const cam = kind === "club" && !globe && t.tilt ? this.v.makeCam(this.v.tiltAngle()) : null;
    this.v.cam = cam;
    this.v.terrainNow = null;
    const lens = kind === "snow" && !globe ? lensOf(w, h) : null;
    // The camera the still picture is drawn through, and the one that moves with the water.
    const fixed: SceneWarp | null = cam
      ? (x, y) => this.v.tp(x, y, 0, cam)
      : lens
        ? (x, y) => {
            const q = lensPoint(lens, x, y);
            return [q[0], q[1], 1];
          }
        : null;
    const bob = kind === "pool" && globe ? Math.sin(now * 1.25) * clamp(R * 0.008, 1.5, 4) : 0;
    const ripple = (y: number) => Math.sin(y / 38 + now * 1.4) * 1.4;
    this.sceneWarp = kind === "pool" ? (globe ? (x, y) => [x, y + bob, 1] : still ? null : (x, y) => [x + ripple(y), y, 1]) : fixed;

    // Nightclub cuts its land to the finer coast at every zoom, so narrow seas and straits stay open (clubLand).
    // The 10m cells too, for the other scenes; Nightclub's floor of tiles and mirrors is cut once from the 50m coast.
    const map = kind === "club" ? (this.v.high ?? this.v.low) : this.v.detailMap(proj, (R >= DETAIL_SCALE ? this.v.high : this.v.low) ?? this.v.low ?? this.v.high, cam, t);
    const backKey = [kind, this.v.mode, w, h, this.v.dpr, cam?.sin.toFixed(5)].join("|");
    let c = this.sceneCache;
    if (!c || c.backKey !== backKey) {
      c = this.sceneCache = { key: "", backKey, front: this.sceneCanvas(c?.front), back: this.sceneCanvas(c?.back) };
      this.paintInto(c.back, (g) => {
        if (kind === "club") drawClubRoom(g, w, h, cam ? this.horizonY(cam) : null);
        if (kind === "pool" && globe) drawPoolNight(g, w, h, h / 2 - this.v.baseScale);
        if (kind === "rave") drawRaveRoom(g, w, h, band, globe);
      });
    }
    const key = [this.v.lon.toFixed(5), this.v.lat.toFixed(5), this.v.zoom.toFixed(5), this.v.anchors.size, cam?.sin.toFixed(5)].join("|");
    if (c.key !== key || c.map !== map || c.relief !== this.v.relief) {
      const cache = c;
      cache.key = key;
      cache.map = map;
      cache.relief = this.v.relief;
      this.paintInto(cache.front, (g) => this.paintSceneFront(g, cache, proj, map, fixed));
    }

    const ctx = this.v.ctx;
    ctx.setTransform(this.v.dpr, 0, 0, this.v.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (kind === "club" || kind === "rave" || (kind === "pool" && globe)) ctx.drawImage(c.back, 0, 0, w, h);
    if (kind === "club" && globe) this.softLight(ctx, (g) => drawSpotlights(g, w, h, now));
    if (kind === "rave") {
      // The light show, round the globe or in the rig above the wall; the still picture then covers the screen.
      const disc = globe ? { cx, cy, R } : null;
      this.softLight(ctx, (g) => drawRaveHaze(g, w, h, band, disc, now));
      drawRaveLasers(ctx, w, h, band, disc, now);
    }
    if (kind === "club" && cam) drawLasers(ctx, w, this.horizonY(cam), now);
    // The floor's lit tiles lie under the still picture, which is cut open along the coast.
    if (kind === "club" && !globe && c.floor) this.drawFloorLight(ctx, c.floor, now);
    if (kind === "pool" && globe) drawPoolRipples(ctx, w, h, cx, cy + R * 0.45, R, now);

    if (kind === "pool" && !globe && !still) {
      // The water bends the floor: thin bands of the picture shifted sideways by a slow wave.
      const band = 10;
      const src = c.front;
      const k = src.height / h;
      for (let y = 0; y < h; y += band) {
        const bh = Math.min(band, h - y);
        ctx.drawImage(src, 0, Math.round(y * k), src.width, Math.max(1, Math.round(bh * k)), ripple(y + bh / 2), y, w, bh);
      }
    } else ctx.drawImage(c.front, 0, bob, w, h);

    let moving = 1;
    if (kind === "club" && globe && c.ball) this.drawBallLight(ctx, c.ball, cx, cy, R, now);
    if (kind === "pool" && !globe) this.drawCaustics(ctx, now);
    if (kind === "pool" && globe) this.drawWaterline(ctx, cx, cy, R, bob);
    if (kind === "snow") moving = this.drawSnow(ctx, globe, cx, cy, R, now, still);

    const view = this.sceneWarp ? warped(proj, this.sceneWarp) : proj;
    if (band) {
      // Arcs stay on the screen, never in the rig or behind the booth.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, globe ? 0 : band, w, globe ? h - band : h - 2 * band);
      ctx.clip();
      this.v.drawArcs(geoPath(view, ctx), proj);
      ctx.restore();
    } else this.v.drawArcs(geoPath(view, ctx), proj);
    this.v.drawDots(proj);
    if (!still && moving > 0) this.scheduleScene();
  }

  /** The globe's land and sea, drawn inside its outline, as every globe design does. */
  private paintWorld(g: CanvasRenderingContext2D, proj: GeoProjection, map: Basemap | undefined, t: Theme, ocean = t.ocean) {
    const path = geoPath(proj, g);
    const R = proj.scale();
    const [cx, cy] = proj.translate();
    g.beginPath();
    path(SPHERE);
    g.fillStyle = ocean;
    g.fill();
    g.save();
    g.beginPath();
    path(SPHERE);
    g.clip();
    g.beginPath();
    path(GRATICULE);
    g.strokeStyle = t.graticule;
    g.lineWidth = 0.7;
    g.stroke();
    if (map) this.v.drawMap(path, proj, map, t);
    if (t.shade) {
      const sg = g.createRadialGradient(cx - R * 0.38, cy - R * 0.42, R * 0.15, cx, cy, R * 1.02);
      sg.addColorStop(0, "rgba(255,255,255,0.12)");
      sg.addColorStop(0.5, "rgba(0,0,0,0)");
      sg.addColorStop(1, t.shade);
      g.fillStyle = sg;
      g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    }
    g.restore();
    g.beginPath();
    path(SPHERE);
    g.strokeStyle = t.coast;
    g.lineWidth = 1;
    g.stroke();
  }

  /** The part of the scene that holds still for this view: the map through the scene's camera and its setting. */
  private paintSceneFront(g: CanvasRenderingContext2D, c: NonNullable<Scenes["sceneCache"]>, proj: GeoProjection, map: Basemap | undefined, fixed: SceneWarp | null) {
    const { w, h, theme: t } = this.v;
    const kind = t.scene!;
    const globe = this.v.mode === "3d";
    const R = proj.scale();
    const [cx, cy] = proj.translate();
    c.ball = undefined;
    c.floor = undefined;
    const anchors = [...this.v.anchors.values()];

    if (kind === "club" && globe) {
      // The chain the ball hangs from, then a dark core under the mirrors so the gaps between them read as grout.
      if (cy - R > 0) {
        g.strokeStyle = "#4a4060";
        g.lineWidth = 2;
        g.setLineDash([4, 2]);
        g.beginPath();
        g.moveTo(cx, 0);
        g.lineTo(cx, cy - R);
        g.stroke();
        g.setLineDash([]);
      }
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.fillStyle = "#0a0710";
      g.fill();
      const step = BALL_STEPS.find((s) => (s * R) / DEG >= 15) ?? BALL_STEPS[BALL_STEPS.length - 1]!;
      const land = this.clubLand(anchors);
      const ball = buildBall({
        proj,
        lon: this.v.lon,
        lat: this.v.lat,
        w,
        h,
        step,
        isLand: land.box,
        anchors: land.stranded,
        land: BALL_LAND,
        sea: BALL_SEA,
      });
      for (const [col, list] of ball.fills) {
        g.fillStyle = col;
        g.fill(new Path2D(list.join("")));
      }
      // The land's mirrors, cut to the coast: a facet across a strait is part pink, part silver.
      if (land.map) {
        g.save();
        g.beginPath();
        geoPath(proj, g)(land.map.land);
        g.clip();
        for (const [col, list] of ball.land) {
          g.fillStyle = col;
          g.fill(new Path2D(list.join("")));
        }
        g.restore();
      }
      g.strokeStyle = "rgba(255,255,255,0.3)";
      g.lineWidth = 0.8;
      g.stroke(new Path2D(ball.edges));
      const rim = g.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.2, cx, cy, R);
      rim.addColorStop(0, "rgba(0,0,0,0)");
      rim.addColorStop(0.72, "rgba(0,0,0,0)");
      rim.addColorStop(1, "rgba(8,0,20,0.6)");
      g.fillStyle = rim;
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.fill();
      c.ball = ball;
      return;
    }

    if (kind === "club") {
      const cam = this.v.cam!;
      const step = FLOOR_STEPS.find(([z]) => this.v.zoom < z)![1];
      const land = this.clubLand(anchors);
      const floor = buildFloor({
        proj,
        tp: (x, y) => this.v.tp(x, y, 0, cam),
        lon: this.v.lon,
        lat: this.v.lat,
        w,
        h,
        step,
        cutoff: SCENE_CUTOFF,
        isLand: land.box,
        anchors: land.stranded,
        sea: [hexRGB("#140d26"), hexRGB("#1e1438")],
        fog: hexRGB(t.fog ?? "#1a0b2e"),
      });
      for (const [col, list] of floor.sea) {
        g.fillStyle = col;
        g.fill(new Path2D(list.join("")));
      }
      // The far floor sinks into the haze, and the room's glow lies on the floor near the horizon.
      const hy = this.horizonY(cam);
      const fog = g.createLinearGradient(0, hy - 4, 0, hy + h * 0.16);
      fog.addColorStop(0, t.fog ?? "#1a0b2e");
      fog.addColorStop(1, "rgba(26,11,46,0)");
      g.fillStyle = fog;
      g.fillRect(0, hy - 4, w, h * 0.16 + 4);
      const glow = g.createRadialGradient(w / 2, hy, 0, w / 2, hy, w * 0.5);
      glow.addColorStop(0, "rgba(190,80,255,0.3)");
      glow.addColorStop(1, "rgba(190,80,255,0)");
      g.fillStyle = glow;
      g.fillRect(0, hy, w, h - hy);
      // Cut the floor open over the land, inside the tiles that hold it, so the lit tiles underneath show in the
      // coast's own shape and every strait stays dark floor between them.
      g.save();
      g.globalCompositeOperation = "destination-out";
      g.fillStyle = "#000";
      g.fill(floor.whole);
      if (land.map) {
        g.beginPath();
        g.rect(0, hy, w, h - hy);
        g.clip();
        g.clip(floor.reach);
        g.beginPath();
        geoPath({ stream: (out: GeoStream) => proj.stream(this.v.tiltStream(out, cam)) } as GeoProjection, g)(land.map.land);
        g.fill();
      }
      g.restore();
      c.floor = floor;
      return;
    }

    if (kind === "pool" && globe) {
      this.paintWorld(g, proj, map, t, "#7fe0e0");
      // A soft sheen, as on an inflatable ball.
      const sheen = g.createRadialGradient(cx - R * 0.42, cy - R * 0.5, 0, cx - R * 0.42, cy - R * 0.5, R * 0.45);
      sheen.addColorStop(0, "rgba(255,255,255,0.35)");
      sheen.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = sheen;
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.fill();
      return;
    }

    if (kind === "pool") {
      // The pool floor: the sea as its plaster, the land painted on it, all laid in square tiles, under deep water.
      g.fillStyle = t.ocean;
      g.fillRect(0, 0, w, h);
      const path = geoPath(proj, g);
      g.beginPath();
      path(GRATICULE);
      g.strokeStyle = t.graticule;
      g.lineWidth = 0.6;
      g.stroke();
      if (map) this.v.drawMap(path, proj, map, t);
      g.fillStyle = this.poolTilePattern(g, proj);
      g.fillRect(0, 0, w, h);
      const water = g.createRadialGradient(w * 0.5, h * 0.6, Math.min(w, h) * 0.1, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
      water.addColorStop(0, "rgba(120,240,240,0.06)");
      water.addColorStop(0.55, "rgba(20,110,160,0.2)");
      water.addColorStop(1, "rgba(12,36,96,0.55)");
      g.fillStyle = water;
      g.fillRect(0, 0, w, h);
      return;
    }

    if (kind === "rave") {
      this.paintRave(g, proj, map, t, globe);
      return;
    }

    if (kind === "snow" && globe) {
      this.paintSnowGlobe(g, proj, map, t);
      return;
    }

    // Snow Globe's map: the flat map seen through curved glass, frost in the corners outside it.
    const L = lensOf(w, h);
    const view = warped(proj, fixed!);
    const path = geoPath(view, g);
    const ellipse = () => {
      g.beginPath();
      g.ellipse(L.cx, L.cy, L.rx, L.ry, 0, 0, Math.PI * 2);
    };
    g.save();
    ellipse();
    g.clip();
    g.fillStyle = t.ocean;
    g.fillRect(0, 0, w, h);
    g.beginPath();
    path(GRATICULE);
    g.strokeStyle = t.graticule;
    g.lineWidth = 0.6;
    g.stroke();
    if (map) this.v.drawMap(path, view, map, t);
    g.save();
    g.translate(L.cx, L.cy);
    g.scale(L.rx, L.ry);
    // Darker toward the rim, then the thick edge of the glass catching the light.
    const vig = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    vig.addColorStop(0, "rgba(40,70,110,0)");
    vig.addColorStop(0.65, "rgba(40,70,110,0.04)");
    vig.addColorStop(0.9, "rgba(40,70,110,0.24)");
    vig.addColorStop(0.955, "rgba(255,255,255,0.3)");
    vig.addColorStop(1, "rgba(150,185,220,0.65)");
    g.fillStyle = vig;
    g.fillRect(-1, -1, 2, 2);
    g.restore();
    g.lineCap = "round";
    g.strokeStyle = "rgba(255,255,255,0.28)";
    g.lineWidth = 14;
    g.beginPath();
    g.ellipse(L.cx, L.cy, L.rx * 0.9, L.ry * 0.9, 0, Math.PI * 1.08, Math.PI * 1.32);
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.5)";
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(L.cx, L.cy, L.rx * 0.86, L.ry * 0.86, 0, Math.PI * 1.36, Math.PI * 1.44);
    g.stroke();
    g.restore();
    this.paintFrost(g, L);
  }

  /** Frost on the window outside the curved glass, with snow drifted along the sill. */
  private paintFrost(g: CanvasRenderingContext2D, L: ReturnType<typeof lensOf>) {
    const { w, h } = this.v;
    g.save();
    g.beginPath();
    g.rect(0, 0, w, h);
    g.ellipse(L.cx, L.cy, L.rx, L.ry, 0, 0, Math.PI * 2);
    g.clip("evenodd");
    const frost = g.createRadialGradient(w / 2, h / 2, Math.min(L.rx, L.ry), w / 2, h / 2, Math.hypot(w, h) / 2);
    frost.addColorStop(0, "#f3f8fc");
    frost.addColorStop(1, "#d7e5f1");
    g.fillStyle = frost;
    g.fillRect(0, 0, w, h);
    // Ice crystals: small six-armed stars, fixed on the pane.
    let seed = 9;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.strokeStyle = "rgba(120,160,200,0.45)";
    g.lineWidth = 0.8;
    g.beginPath();
    for (let i = 0; i < 260; i++) {
      const x = rnd() * w, y = rnd() * h, s = 2 + rnd() * 5;
      if (((x - L.cx) / L.rx) ** 2 + ((y - L.cy) / L.ry) ** 2 < 1.02) continue;
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3 + rnd() * 0.2;
        g.moveTo(x - Math.cos(a) * s, y - Math.sin(a) * s);
        g.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s);
      }
    }
    g.stroke();
    // The drift the falling snow settles on.
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 6) g.lineTo(x, h / 2 + (h / 2) * snowFloor("box", (x - w / 2) / (h / 2)) + 2);
    g.lineTo(w, h);
    g.closePath();
    g.fillStyle = "#ffffff";
    g.fill();
    g.restore();
    // The glass's edge.
    g.beginPath();
    g.ellipse(L.cx, L.cy, L.rx, L.ry, 0, 0, Math.PI * 2);
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.lineWidth = 5;
    g.stroke();
    g.strokeStyle = "rgba(60,90,125,0.55)";
    g.lineWidth = 1.2;
    g.stroke();
  }

  private ledPattern?: CanvasPattern;

  /**
   * Rave's screens, which hold still for the view: the map on the LED wall between the rig and the booth, or the
   * globe as a round LED screen hung from the rig on two cables, both with the dark gaps between their pixels.
   */
  private paintRave(g: CanvasRenderingContext2D, proj: GeoProjection, map: Basemap | undefined, t: Theme, globe: boolean) {
    const { w, h } = this.v;
    const band = raveBand(h);
    const led = (this.ledPattern ??= g.createPattern(ledTile(), "repeat")!);
    if (globe) {
      const R = proj.scale();
      const [cx, cy] = proj.translate();
      const rig = band * 0.38;
      if (cy - R > rig) {
        g.strokeStyle = "#3a3150";
        g.lineWidth = 1.5;
        g.beginPath();
        for (const s of [-0.45, 0.45]) {
          g.moveTo(cx + s * R, rig);
          g.lineTo(cx + s * R, cy - Math.sqrt(1 - s * s) * R);
        }
        g.stroke();
      }
      this.paintWorld(g, proj, map, t);
      g.save();
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = led;
      g.fillRect(0, 0, w, h);
      g.restore();
      // The screen's rim, lit UV.
      g.beginPath();
      g.arc(cx, cy, R + 1.5, 0, Math.PI * 2);
      g.strokeStyle = "rgba(138,77,255,0.85)";
      g.lineWidth = 2.5;
      g.stroke();
      return;
    }
    const top = band, tall = h - 2 * band;
    g.save();
    g.beginPath();
    g.rect(0, top, w, tall);
    g.clip();
    g.fillStyle = t.ocean;
    g.fillRect(0, top, w, tall);
    const path = geoPath(proj, g);
    g.beginPath();
    path(GRATICULE);
    g.strokeStyle = t.graticule;
    g.lineWidth = 0.6;
    g.stroke();
    if (map) this.v.drawMap(path, proj, map, t);
    g.fillStyle = led;
    g.fillRect(0, top, w, tall);
    g.restore();
    // The wall's edge: a dark frame, lit UV along its outside.
    g.strokeStyle = "#000000";
    g.lineWidth = 3;
    g.strokeRect(-3, top - 1.5, w + 6, tall + 3);
    g.strokeStyle = "rgba(138,77,255,0.8)";
    g.lineWidth = 1;
    g.strokeRect(-3, top - 3.5, w + 6, tall + 7);
  }

  /** The globe inside a glass dome on a wooden base, seen slightly from below. */
  private paintSnowGlobe(g: CanvasRenderingContext2D, proj: GeoProjection, map: Basemap | undefined, t: Theme) {
    const { w, h } = this.v;
    const R = proj.scale();
    const [cx, cy] = proj.translate();
    const G = R * SNOW_DOME;
    const topY = cy + G * 0.9, botY = cy + G * 1.3;
    const topW = G * 0.8, botW = G * 0.98, bow = G * 0.07;
    // The shelf it stands on.
    if (botY - bow < h) {
      const shelf = g.createLinearGradient(0, botY - bow, 0, h);
      shelf.addColorStop(0, "#8a5a33");
      shelf.addColorStop(0.15, "#6d4122");
      shelf.addColorStop(1, "#3e220f");
      g.fillStyle = shelf;
      g.fillRect(0, botY - bow, w, h - botY + bow);
      g.fillStyle = "rgba(255,220,170,0.35)";
      g.fillRect(0, botY - bow, w, 2);
      const shadow = g.createRadialGradient(cx, botY, 0, cx, botY, botW * 1.3);
      shadow.addColorStop(0, "rgba(20,8,0,0.45)");
      shadow.addColorStop(1, "rgba(20,8,0,0)");
      g.fillStyle = shadow;
      g.fillRect(cx - botW * 1.4, botY - bow, botW * 2.8, botW);
    }
    // Glass and water behind the world.
    const dome = () => {
      g.beginPath();
      g.arc(cx, cy, G, 0, Math.PI * 2);
    };
    const back = g.createRadialGradient(cx - G * 0.3, cy - G * 0.35, G * 0.1, cx, cy, G);
    back.addColorStop(0, "rgba(235,245,255,0.14)");
    back.addColorStop(1, "rgba(175,205,235,0.34)");
    g.fillStyle = back;
    dome();
    g.fill();
    // The mound of settled snow the world rests on.
    g.save();
    dome();
    g.clip();
    g.beginPath();
    g.moveTo(cx - G, cy + G);
    for (let x = -1; x <= 1.001; x += 0.05) g.lineTo(cx + x * G, cy + G * snowFloor("dome", x) + 2);
    g.lineTo(cx + G, cy + G);
    g.closePath();
    const pile = g.createLinearGradient(0, cy + G * 0.78, 0, cy + G);
    pile.addColorStop(0, "#ffffff");
    pile.addColorStop(1, "#c9dbee");
    g.fillStyle = pile;
    g.fill();
    g.restore();
    this.paintWorld(g, proj, map, t);
    // The glass in front: soft highlights in the water around the world, never over it.
    g.save();
    dome();
    g.arc(cx, cy, R + 1, 0, Math.PI * 2, true);
    g.clip("evenodd");
    // Light through curved glass gathers toward the rim.
    const edge = g.createRadialGradient(cx, cy, R, cx, cy, G);
    edge.addColorStop(0, "rgba(255,255,255,0)");
    edge.addColorStop(0.75, "rgba(220,236,255,0.12)");
    edge.addColorStop(1, "rgba(235,245,255,0.45)");
    g.fillStyle = edge;
    g.fillRect(cx - G, cy - G, 2 * G, 2 * G);
    g.lineCap = "round";
    const streak = (r: number, a0: number, a1: number, width: number, col: string) => {
      g.strokeStyle = col;
      g.lineWidth = width;
      g.beginPath();
      g.arc(cx, cy, r, Math.PI * a0, Math.PI * a1);
      g.stroke();
    };
    streak(G * 0.9, 1.06, 1.42, G * 0.07, "rgba(255,255,255,0.28)");
    streak(G * 0.91, 1.1, 1.36, G * 0.03, "rgba(255,255,255,0.75)");
    streak(G * 0.9, 1.47, 1.55, G * 0.024, "rgba(255,255,255,0.55)");
    // The shop's warm lights reflected on the right, and light bouncing up from the base below.
    streak(G * 0.9, 1.78, 1.9, G * 0.05, "rgba(255,214,150,0.35)");
    streak(G * 0.92, 0.12, 0.32, G * 0.028, "rgba(255,226,180,0.4)");
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.beginPath();
    g.ellipse(cx + Math.cos(Math.PI * 1.25) * G * 0.86, cy + Math.sin(Math.PI * 1.25) * G * 0.86, G * 0.035, G * 0.022, Math.PI * 0.75, 0, Math.PI * 2);
    g.fill();
    g.restore();
    const reach = Math.hypot(w, h) / 2;
    if (G * 0.9 > reach) {
      // Zoomed in, the camera is up against the glass: its curve still catches the light in the corners.
      g.save();
      g.lineCap = "round";
      streak(reach * 0.86, 1.1, 1.34, Math.min(w, h) * 0.035, "rgba(255,255,255,0.24)");
      streak(reach * 0.86, 1.8, 1.9, Math.min(w, h) * 0.025, "rgba(255,214,150,0.22)");
      g.restore();
    }
    dome();
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 2.5;
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, G - 2.5, 0, Math.PI * 2);
    g.strokeStyle = "rgba(90,130,175,0.45)";
    g.lineWidth = 1;
    g.stroke();
    // The wooden base: its rims bow upward because the camera is a little below them.
    g.beginPath();
    g.moveTo(cx - topW, topY + bow);
    g.quadraticCurveTo(cx, topY - bow, cx + topW, topY + bow);
    g.lineTo(cx + botW, botY);
    g.quadraticCurveTo(cx, botY - 2 * bow, cx - botW, botY);
    g.closePath();
    const wood = g.createLinearGradient(cx - botW, 0, cx + botW, 0);
    wood.addColorStop(0, "#4a2610");
    wood.addColorStop(0.3, "#b0703b");
    wood.addColorStop(0.45, "#c98a4f");
    wood.addColorStop(0.75, "#7a4520");
    wood.addColorStop(1, "#3a1d0a");
    g.fillStyle = wood;
    g.fill();
    g.strokeStyle = "rgba(40,18,4,0.7)";
    g.lineWidth = 1.2;
    g.stroke();
    // A moulding band and grain.
    g.save();
    g.clip();
    for (const [f, col, lw] of [
      [0.22, "rgba(255,220,170,0.45)", 2],
      [0.3, "rgba(40,18,4,0.45)", 1.5],
      [0.8, "rgba(255,220,170,0.3)", 1.5],
    ] as const) {
      const y = topY + (botY - topY) * f;
      const half = topW + (botW - topW) * f;
      g.beginPath();
      g.moveTo(cx - half, y + bow);
      g.quadraticCurveTo(cx, y - bow - bow * f, cx + half, y + bow);
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.stroke();
    }
    g.strokeStyle = "rgba(60,28,8,0.18)";
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < 9; i++) {
      const x0 = cx - botW + (i + 0.5) * ((2 * botW) / 9);
      g.moveTo(x0, topY);
      g.bezierCurveTo(x0 + G * 0.03, topY + G * 0.12, x0 - G * 0.03, botY - G * 0.15, x0 + G * 0.01, botY);
    }
    g.stroke();
    g.restore();
    // A blank brass plate on the front.
    const pw = G * 0.36, ph = G * 0.11, py = topY + (botY - topY) * 0.55 - ph / 2;
    const brass = g.createLinearGradient(0, py, 0, py + ph);
    brass.addColorStop(0, "#f6dc8c");
    brass.addColorStop(0.5, "#c9a14a");
    brass.addColorStop(1, "#8c6a22");
    g.fillStyle = brass;
    g.beginPath();
    g.roundRect(cx - pw / 2, py, pw, ph, ph * 0.3);
    g.fill();
    g.strokeStyle = "rgba(70,45,10,0.7)";
    g.lineWidth = 1;
    g.stroke();
  }

  /** Square pool tiles over the floor, fixed to the world so they move with the map. */
  private poolTilePattern(g: CanvasRenderingContext2D, proj: GeoProjection): CanvasPattern {
    if (!this.poolTiles) {
      const size = 18, n = 4;
      const c = document.createElement("canvas");
      c.width = c.height = size * n * 2;
      const tg = c.getContext("2d")!;
      tg.scale(2, 2);
      let seed = 3;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const v = rnd();
          tg.fillStyle = v < 0.5 ? `rgba(255,255,255,${(v * 0.12).toFixed(3)})` : `rgba(0,40,80,${((v - 0.5) * 0.12).toFixed(3)})`;
          tg.fillRect(i * size, j * size, size, size);
        }
      tg.strokeStyle = "rgba(255,255,255,0.3)";
      tg.lineWidth = 1;
      tg.beginPath();
      for (let i = 0; i <= n; i++) {
        tg.moveTo(i * size + 0.5, 0);
        tg.lineTo(i * size + 0.5, size * n);
        tg.moveTo(0, i * size + 0.5);
        tg.lineTo(size * n, i * size + 0.5);
      }
      tg.stroke();
      this.poolTiles = g.createPattern(c, "repeat")!;
    }
    const a = proj([0, 0]) ?? [0, 0];
    const span = 72;
    this.poolTiles.setTransform(new DOMMatrix().translate(((a[0] % span) + span) % span, ((a[1] % span) + span) % span).scale(0.5));
    return this.poolTiles;
  }

  /** The mirror ball catching the moving lights, and the specks it throws across the room. */
  private drawBallLight(ctx: CanvasRenderingContext2D, ball: Ball, cx: number, cy: number, R: number, now: number) {
    const lights: RGB[] = [
      [255, 255, 255],
      [255, 140, 235],
      [120, 235, 255],
    ];
    const glints = ballGlints(ball, now, lights);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const [key, list] of glints) {
      const [l, level] = key.split(":").map(Number);
      ctx.fillStyle = css(lights[l!]!, 0.16 * level!);
      ctx.fill(new Path2D(list.join("")));
    }
    ctx.restore();
    drawSpecks(ctx, cx, cy, R, this.v.w, this.v.h, now);
  }

  /** The dance floor's land tiles, each moving slowly through the neon colours, fading into the haze far off. */
  private drawFloorLight(ctx: CanvasRenderingContext2D, floor: Floor, now: number) {
    const fog = hexRGB(this.v.theme.fog ?? "#1a0b2e");
    const white: RGB = [255, 255, 255];
    const colors = new Map<number, RGB>();
    for (const tile of floor.land) {
      let col = colors.get(tile.cls);
      if (!col) colors.set(tile.cls, (col = floorColor(tile.cls, now)));
      const haze = ((tile.level + 0.5) / FLOOR_LEVELS) * 0.8;
      const lit = mix(col, fog, haze);
      ctx.fillStyle = css(lit);
      ctx.fill(tile.outer);
      ctx.fillStyle = css(mix(lit, white, 0.45 * (1 - haze)));
      ctx.fill(tile.inner);
    }
  }

  /** Light rippling over the pool floor: two frames of the caustic loop, cross-faded, drifting slowly. */
  private drawCaustics(ctx: CanvasRenderingContext2D, now: number) {
    if (!this.caustics) this.caustics = causticFrames().map((f) => ctx.createPattern(f, "repeat")!);
    const frames = this.caustics;
    const n = frames.length;
    const u = (now / 7) * n;
    const i = Math.floor(u) % n;
    const f = u - Math.floor(u);
    const m = new DOMMatrix().translate((now * 6) % 272, (now * 3.5) % 272).scale(1.7);
    this.softLight(ctx, (g) => {
      g.globalCompositeOperation = "lighter";
      for (const [pat, a] of [
        [frames[i]!, 1 - f],
        [frames[(i + 1) % n]!, f],
      ] as const) {
        pat.setTransform(m);
        g.globalAlpha = 0.24 * a;
        g.fillStyle = pat;
        g.fillRect(0, 0, this.v.w, this.v.h);
      }
    });
  }

  private lightBuffer?: HTMLCanvasElement;

  /**
   * Soft light drawn at a third of the resolution and added over the frame, enlarged smoothed: caustics and
   * spotlights have no sharp detail, and this keeps an idle frame cheap.
   */
  private softLight(ctx: CanvasRenderingContext2D, draw: (g: CanvasRenderingContext2D) => void) {
    const c = (this.lightBuffer ??= document.createElement("canvas"));
    const W = Math.max(1, Math.round(this.v.w / 3)), H = Math.max(1, Math.round(this.v.h / 3));
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.clearRect(0, 0, W, H);
    g.setTransform(W / this.v.w, 0, 0, H / this.v.h, 0, 0);
    draw(g);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(c, 0, 0, this.v.w, this.v.h);
    ctx.restore();
  }

  /** The globe afloat: the part under the waterline seen through the water, and the bright line where they meet. */
  private drawWaterline(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, bob: number) {
    const wy = cy + R * 0.45, rx = R * 0.9, ry = R * 0.2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy + bob, R + 0.5, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(cx - 2 * R, wy);
    ctx.lineTo(cx - rx, wy);
    ctx.ellipse(cx, wy, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(cx + 2 * R, wy);
    ctx.lineTo(cx + 2 * R, cy + 2 * R);
    ctx.lineTo(cx - 2 * R, cy + 2 * R);
    ctx.closePath();
    const under = ctx.createLinearGradient(0, wy, 0, cy + R);
    under.addColorStop(0, "rgba(24,170,185,0.4)");
    under.addColorStop(1, "rgba(8,55,100,0.62)");
    ctx.fillStyle = under;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(cx, wy, rx, ry, 0, Math.PI, 0, true);
    ctx.strokeStyle = "rgba(210,255,255,0.22)";
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = "rgba(235,255,255,0.85)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  /**
   * Snow in the dome around the world, or outside the window's glass. A drag stirs it up; it then settles, and
   * once every flake rests, no more frames are asked for. Returns how many flakes still move.
   */
  private drawSnow(ctx: CanvasRenderingContext2D, globe: boolean, cx: number, cy: number, R: number, now: number, still: boolean): number {
    const { w, h } = this.v;
    const shape = globe ? "dome" : "box";
    if (!this.snow || this.snow.shape !== shape) {
      this.snow = new Snow(260, shape, w / h);
      if (still) this.snow.settle();
      this.sceneLast = null;
    }
    const S = this.snow;
    S.aspect = w / h;
    let moving = 0;
    const last = this.sceneLast;
    if (!still) {
      if (last && !this.v.spinning && !this.v.anim) {
        const k = this.v.baseScale * this.v.zoom;
        const dx = (-wrap(this.v.lon - last.lon) * k) / DEG, dy = ((this.v.lat - last.lat) * k) / DEG;
        const d = Math.hypot(dx, dy);
        if (d > 0.5) S.stir(d / 50, dx / d, dy / d);
      }
      moving = S.step(last ? clamp(now - last.t, 0, 0.1) : 0, now);
    }
    this.sceneLast = { lon: this.v.lon, lat: this.v.lat, t: now };
    const unit = globe ? R * SNOW_DOME : h / 2;
    const ox = globe ? cx : w / 2, oy = globe ? cy : h / 2;
    ctx.save();
    ctx.beginPath();
    if (globe) {
      ctx.arc(cx, cy, unit * 0.99, 0, Math.PI * 2);
      ctx.moveTo(cx + R + 1, cy);
      ctx.arc(cx, cy, R + 1, 0, Math.PI * 2, true);
    } else {
      const L = lensOf(w, h);
      ctx.rect(0, 0, w, h);
      ctx.ellipse(L.cx, L.cy, L.rx, L.ry, 0, 0, Math.PI * 2);
    }
    ctx.clip("evenodd");
    const p = new Path2D();
    for (let i = 0; i < S.n; i++) {
      const x = ox + S.x[i]! * unit, y = oy + S.y[i]! * unit, r = S.size[i]! * 1.25;
      p.moveTo(x + r, y);
      p.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fill(p);
    ctx.strokeStyle = globe ? "rgba(120,150,190,0.35)" : "rgba(120,150,190,0.5)";
    ctx.lineWidth = 0.6;
    ctx.stroke(p);
    ctx.restore();
    return moving;
  }
}

/** Decision 71: frames of moving light per second (slow light needs no more), and where the dance floor ends in haze. */
const SCENE_FPS = 12;
const SCENE_CUTOFF = 0.6;
/** The snow globe's glass dome, as a multiple of the world's radius. */
const SNOW_DOME = 1.26;
/** Mirror ball facet sizes in degrees; the smallest that is still at least 15 pixels across is used. */
const BALL_STEPS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6];
/** The mirror ball's land and sea mirrors, from unlit to lit. */
const BALL_LAND: [RGB, RGB] = [hexRGB("#3a0850"), hexRGB("#ff7ae6")];
const BALL_SEA: [RGB, RGB] = [hexRGB("#0b1430"), hexRGB("#b4dcff")];
/** Dance floor tile sizes in degrees by zoom: large tiles at the whole world, smaller as you zoom in. */
const FLOOR_STEPS: [number, number][] = [
  [3, 3],
  [6, 1.5],
  [11, 0.75],
  [Infinity, 0.375],
];

export const createScenes = (view: MapView) => new Scenes(view);
