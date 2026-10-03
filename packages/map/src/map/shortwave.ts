// Shortwave (experimental): after the feel of a mid-century world-band radio receiver, with no maker's name, logo or
// dial printing copied. The map itself is drawn the usual way from the theme; what is the design's own is the tuning
// dial under the map (src/ui/dial.ts). This file lays the dial out and times its light, with no DOM, so the test can
// check it: where the needle stands for a longitude and back, the printed scale, how the knob turns with the world,
// and the static and the lamp, which never flash.

/** The scale runs west to east across the dial window, 180 W at the left end and 180 E at the right. */
export function dialAt(lon: number): number {
  const l = ((((lon + 180) % 360) + 360) % 360) - 180;
  return (l + 180) / 360;
}

/** The longitude at a share of the way along the scale (clamped to its ends). */
export function lonAt(f: number): number {
  return Math.min(1, Math.max(0, f)) * 360 - 180;
}

/** Room each printed number needs on the scale, in CSS pixels: the widest is "120W" in the dial's condensed face. */
export const LABEL_PX = 38;

/** The longitude between printed numbers for a scale this wide: every 30 degrees, or 60 or 90 on a narrow phone. */
export function scaleStep(widthPx: number): 30 | 60 | 90 {
  for (const step of [30, 60, 90] as const) if ((widthPx * step) / 360 >= LABEL_PX) return step;
  return 90;
}

export interface ScaleLabel {
  lon: number;
  /** The number as printed, without its side. */
  num: string;
  /** "W", "E", or "" for 0 and 180. */
  side: "W" | "E" | "";
}

/** The printed numbers, west to east, both ends included, like a band's frequencies. */
export function scaleLabels(step: number): ScaleLabel[] {
  const out: ScaleLabel[] = [];
  for (let lon = -180; lon <= 180; lon += step) {
    const a = Math.abs(lon);
    out.push({ lon, num: String(a), side: a === 0 || a === 180 ? "" : lon < 0 ? "W" : "E" });
  }
  return out;
}

/** What a screen reader hears for the needle's place: "36.8 degrees east". */
export function lonText(lon: number): string {
  const a = Math.round(Math.abs(lon) * 10) / 10;
  if (a === 0) return "0 degrees";
  if (a === 180) return "180 degrees";
  return `${a} degrees ${lon < 0 ? "west" : "east"}`;
}

/**
 * The knob is geared to the needle like a real dial's cord drive: it turns this many degrees for each degree the world
 * turns, clockwise for east. It is decoration that follows the world; it never sets anything by its own angle.
 */
export const KNOB_PER_DEG = 4;

/** A drag round the knob moves the reticle east by this many screen pixels per degree it turns, so fine tuning is easy at any zoom. */
export const PX_PER_KNOB_DEG = 1.2;

/** Arrow keys on the knob move the reticle as far as the map's own arrow keys do (view.ts), Page Up and Down four times as far. */
export const KEY_PX = 40;
export const PAGE_PX = 160;

/** The signed difference in degrees from one angle to another, the short way round. */
export function turnBetween(from: number, to: number): number {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

/**
 * Between places a faint grain lies over the dial window, and over nothing else. It drifts slowly, one tile in
 * `STATIC_DRIFT_S` seconds, so its average light never changes; it holds still for reduced motion and fades out over
 * `STATIC_FADE_S` once a place is tuned.
 */
export const STATIC_OPACITY = 0.42;
export const STATIC_DRIFT_S = 16;
export const STATIC_FADE_S = 0.6;

/**
 * The tuning lamp: a small green eye that glows brighter, its dark wedge narrowing, when a place is tuned. It says
 * only that, never how strong or important anything is. Its glow comes up and goes down over `LAMP_FADE_S`, a CSS
 * transition the page sets from here.
 */
export const LAMP_DIM = 0.42;
export const LAMP_LIT = 1;
export const LAMP_FADE_S = 0.5;
/** The dark wedge's opening, in degrees, untuned and tuned. */
export const EYE_OPEN = 90;
export const EYE_SHUT = 14;

/** The lamp's glow `t` seconds after it was asked to change, as a linear fade between the two levels. */
export function lampLevel(t: number, from: number, to: number): number {
  const k = Math.min(1, Math.max(0, t / LAMP_FADE_S));
  return from + (to - from) * k;
}

/**
 * The eye closes by two green wings, one each side of the dark wedge, turning in over it: each wing is as wide as it
 * turns, so tuned, the wedge shows only `EYE_SHUT` degrees.
 */
export const WING_TURN = (EYE_OPEN - EYE_SHUT) / 2;

/** The eye's radius in its 40 by 40 drawing. */
export const EYE_R = 17;

/**
 * A sector of the eye from the centre, between two angles in degrees measured clockwise from straight up, as SVG path
 * data in the lamp's 40 by 40 drawing.
 */
export function sectorPath(from: number, to: number, r = EYE_R): string {
  const pt = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(20 + r * Math.sin(a)).toFixed(2)} ${(20 - r * Math.cos(a)).toFixed(2)}`;
  };
  return `M20 20L${pt(from)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${pt(to)}Z`;
}
