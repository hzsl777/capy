// Old Realm's round minimap (Map view only): the world is seen through a circle at the frame's centre, and the page
// draws a carved stone ring with a compass rose around it (src/ui/extras.ts). The canvas and the ring both size
// the circle here, so they always line up.

import type { SurfaceResult } from "./surface.ts";

/** The margin left for the ring between the circle and the frame's shorter side, in CSS pixels. */
export function minimapMargin(w: number, h: number): number {
  return Math.min(w, h) < 520 ? 16 : 30;
}

/** The window's centre and radius in a frame of w by h CSS pixels. */
export function minimapDisc(w: number, h: number): { cx: number; cy: number; r: number } {
  return { cx: w / 2, cy: h / 2, r: Math.max(40, Math.min(w, h) / 2 - minimapMargin(w, h)) };
}

/** The circle as a clip, and a test that keeps places outside it from being drawn or tuned. */
export function minimapFrame(w: number, h: number): SurfaceResult {
  const { cx, cy, r } = minimapDisc(w, h);
  const clip = new Path2D();
  clip.arc(cx, cy, r, 0, Math.PI * 2);
  return { clip, inside: (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r };
}
