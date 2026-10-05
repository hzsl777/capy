// Motion of its own for the designs that have some (decision 77): Aquarium's fish, bubbles and water, Lava Lamp's
// wax. The view asks for a frame every so often while one of these designs shows, at a gentle rate, and never for
// readers who ask for reduced motion. The browser holds animation frames while the tab is hidden, so the motion
// stops there too. Markers never move with it.

import type { Theme } from "../themes.ts";
import { offscreen, type SurfaceFrame } from "./surface.ts";

/**
 * Milliseconds between frames a design's own motion asks for, by `surface`. About 12 and 5 frames a second; Green
 * Core's energy and tube light 8, which also carries its opening; Alien's slow lights and critters 10.
 */
const AMBIENT_MS: Partial<Record<NonNullable<Theme["surface"]>, number>> = { aquarium: 80, lava: 200, core: 125, alien: 100 };

let reduce: MediaQueryList | null = null;

/** Whether the reader asked for reduced motion. Everything that moves on its own holds still then. */
export function stillMotion(): boolean {
  if (typeof matchMedia !== "function") return true;
  reduce ??= matchMedia("(prefers-reduced-motion: reduce)");
  return reduce.matches;
}

/** How long to wait before the next frame of a design's own motion, or 0 for none. */
export function ambientDelay(t: Theme): number {
  const ms = t.surface ? (AMBIENT_MS[t.surface] ?? 0) : 0;
  return !ms || stillMotion() ? 0 : ms;
}

/** Seconds on the motion clock. It holds at one moment for reduced motion, so the picture is still. */
export function motionTime(): number {
  return stillMotion() ? 12 : performance.now() / 1000;
}

/**
 * Draws only the part of a frame-sized offscreen layer inside a box (clamped to the frame), since copying the
 * empty rest of it every frame costs as much as copying the picture.
 */
export function drawPart(f: SurfaceFrame, layer: HTMLCanvasElement, x0: number, y0: number, x1: number, y1: number) {
  const { ctx, w, h, dpr } = f;
  const x = Math.max(0, Math.floor(x0)), y = Math.max(0, Math.floor(y0));
  const r = Math.min(w, Math.ceil(x1)), b = Math.min(h, Math.ceil(y1));
  if (r <= x || b <= y) return;
  ctx.drawImage(layer, x * dpr, y * dpr, (r - x) * dpr, (b - y) * dpr, x, y, r - x, b - y);
}

/** What identifies a picture of the world: the view's position, zoom and size. */
export const viewKey = (f: SurfaceFrame) => `${f.mode}|${f.lon}|${f.lat}|${f.zoom}|${f.w}|${f.h}|${f.dpr}`;

/**
 * A layer that changes only when the view moves, such as the world under Aquarium's fish or Lava Lamp's land over
 * the wax. While the view moves it is drawn straight onto the frame, which costs nothing extra; once a frame repeats
 * the last position, it is drawn once into an offscreen canvas and reused for the frames the motion asks for.
 */
export class StillLayer {
  private key = "";
  private map: unknown = null;
  private canvas?: HTMLCanvasElement;
  private g?: CanvasRenderingContext2D;
  private ready = false;

  /** `box` (x0, y0, x1, y1), when given, bounds what `paint` draws, so a kept copy is drawn only that far. */
  draw(f: SurfaceFrame, paint: (g: CanvasRenderingContext2D) => void, box?: readonly [number, number, number, number]) {
    const { ctx, w, h, dpr } = f;
    const key = viewKey(f);
    if (key !== this.key || f.map !== this.map) {
      this.key = key;
      this.map = f.map;
      this.ready = false;
      paint(ctx);
      return;
    }
    if (!this.ready || !this.canvas || !this.g) {
      if (!this.canvas || this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) [this.canvas, this.g] = offscreen(w, h, dpr);
      const g = this.g!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      paint(g);
      this.ready = true;
    }
    if (box) drawPart(f, this.canvas, ...box);
    else ctx.drawImage(this.canvas, 0, 0, w, h);
  }
}
