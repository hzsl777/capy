// The reader's tilt in Map view: drag with the right mouse button (or Shift or Ctrl with the left), two fingers up or
// down, or Page Up and Page Down, to stand a flat design up into perspective or lay a tilted one flat. It changes only
// the angle the view's camera already uses (`tilt`, `tiltEye`, `placeAt()` in view.ts), so land, arcs, places and
// tuning follow it as they do for the designs that are tilted by default.

import type { Theme } from "../themes.ts";

/** The steepest a reader may stand up a design that is flat by default, in degrees. */
export const TILT_MAX = 64;

/** Degrees of tilt per pixel of vertical drag. */
export const TILT_PER_PX = 0.3;

/** Degrees per press of Page Up or Page Down. */
export const TILT_KEY_STEP = 8;

/**
 * Designs that draw the world their own way and draw it through the tilted camera, with the lowest tilt their
 * picture holds together at: Night Drive's and Sleeper Car's horizon, sun and sky stay on screen, and Pop-up Book's
 * and Toy Train Set's standing pieces keep a little depth.
 */
const CAMERA_SURFACES: Partial<Record<NonNullable<Theme["surface"]>, number>> = { neon: 52, popup: 8, trainset: 8 };

/**
 * The tilts a reader may choose for a design in Map view, lowest and highest in degrees, or null where the design's
 * picture can't take another camera: a warp (the tube, the big screen, the desk) already bends it, a surface draws it
 * flat to the screen, Poolside and Snow Globe have their own lens, and the pictures at sea (Pirate's monsters, the
 * frogs, the sweets, the stars) are drawn flat and sized to stay off land, which a tilt would bring closer on screen.
 * The dance floor's camera works out its horizon from the tilt, so it keeps a little.
 */
export function tiltRange(t: Pick<Theme, "tilt" | "warp" | "scene" | "surface" | "decor" | "scenery" | "minimap">): [number, number] | null {
  const hi = Math.max(TILT_MAX, t.tilt ?? 0);
  // Old Realm's round minimap window is cut flat to the screen.
  if (t.warp || t.decor || t.scenery || t.minimap) return null;
  if (t.scene) return t.scene === "club" ? [10, hi] : null;
  if (t.surface) {
    const lo = CAMERA_SURFACES[t.surface];
    return lo === undefined ? null : [lo, hi];
  }
  return [0, hi];
}

/** The camera's angle with the reader's change `by` on top of the design's own `base`, kept inside `range`. */
export function readerTilt(base: number, by: number, range: [number, number] | null): number {
  if (!range || by === 0) return base;
  return Math.min(range[1], Math.max(range[0], base + by));
}

/**
 * The reader's change after moving it by `delta` degrees, clamped so the angle stays inside `range`: dragging past
 * the end and back moves the camera at once, rather than first unwinding the overshoot.
 */
export function stepTilt(base: number, by: number, delta: number, range: [number, number] | null): number {
  if (!range) return 0;
  return readerTilt(base, by + delta, range) - base;
}

/**
 * What two fingers are doing, from how far their midpoint moved up or down and how much the gap between them changed
 * since they touched: tilting (both moving up or down together), pinching, or not yet clear.
 */
export function twoFingerGesture(midDy: number, gapChange: number, canTilt: boolean): "tilt" | "pinch" | null {
  const up = Math.abs(midDy);
  const gap = Math.abs(gapChange);
  if (canTilt && up > 12 && gap < up * 0.5) return "tilt";
  if (gap > 12 || (!canTilt && up > 12)) return "pinch";
  return null;
}
