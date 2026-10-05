// Lobster's one change of how the site is used: hauling a trap. The panel is the pot, and when a place is tuned it comes
// up from the water (a short rise in CSS, `.panel.x-haul` in style.css). Only the panel's position moves, for under a
// second, and never for readers who ask for reduced motion. Tuning, dragging and the snap to the nearest place are the
// map's own and are not touched; this module only watches which place is tuned.

import type { ThemeId } from "../themes.ts";

/** How long the class stays on: the rise is 0.85 s, and a new tune starts it over. */
export const HAUL_MS = 900;

let timer = 0;
let last = "";

/**
 * Called whenever the tuned place changes. Hauls the panel up when a place (not nothing) is tuned and it is not the
 * place already shown. `indices` is the tuned place or merged places, or null between places.
 */
export function haul(theme: ThemeId, panel: HTMLElement, indices: readonly number[] | null) {
  const key = indices ? indices.join(",") : "";
  if (theme !== "lobster") {
    last = "";
    return;
  }
  if (!key || key === last) {
    last = key;
    return;
  }
  last = key;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden) return;
  // Restart the animation if one is running: remove the class, force a style flush, add it back.
  panel.classList.remove("x-haul");
  void panel.offsetWidth;
  panel.classList.add("x-haul");
  clearTimeout(timer);
  timer = window.setTimeout(() => panel.classList.remove("x-haul"), HAUL_MS);
}
