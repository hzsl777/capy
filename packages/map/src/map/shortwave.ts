// Shortwave (id shortwave): after the feel of a mid-century world-band radio receiver, with no maker's name, logo or
// dial printing copied. The map itself is drawn the usual way from the theme; what is the design's own is the radio's
// front under the map (src/ui/dial.ts). This file lays the dial out and times its moving parts, with no DOM, so the
// test can check it: where the needle stands for a longitude and back, the printed scale, how the knob turns with the
// world, how it spins on and falls into its detents, how the eye and the static follow the reticle's nearness to a
// place, the bands and the time knob. Nothing on it flashes.

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
 * The knob is geared to the needle like a real dial's cord drive: when something else turns the world (the dial's
 * window, a flight to a place, the idle spin) it turns this many degrees for each degree the world turns, clockwise
 * for east. It is decoration that follows the world; it never sets anything by its own angle.
 */
export const KNOB_PER_DEG = 4;

/** Turning the knob by hand moves the reticle east by this many screen pixels per degree, so fine tuning is easy at any zoom. */
export const PX_PER_KNOB_DEG = 1.4;

/** An arrow key on the knob turns it this many detents (a Shift arrow one), about as far as the map's own arrow keys move. */
export const KEY_DETENTS = 3;

/** The signed difference in degrees from one angle to another, the short way round. */
export function turnBetween(from: number, to: number): number {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

/**
 * The tuning knob clicks through detents, one every `DETENT_DEG` degrees, 36 to a turn. Under the finger a detent is a
 * little sticky: the knob turns `1 - DETENT_SOFT * cos(...)` as fast as the hand, slowest at the centre of a detent
 * and quickest between two, and never backwards, so the world turns in small catches.
 */
export const DETENT_DEG = 10;
export const DETENT_SOFT = 0.34;

/** How far the knob turns for `d` degrees of the hand when it stands at `angle`. */
export function detentStep(angle: number, d: number, detent = DETENT_DEG): number {
  return d * (1 - DETENT_SOFT * Math.cos((2 * Math.PI * angle) / detent));
}

/** The detent a knob angle is nearest to, as a whole number of detents from zero. */
export function detentAt(angle: number, detent = DETENT_DEG): number {
  return Math.round(angle / detent);
}

/**
 * A knob let go while turning keeps going like a flywheel: friction slows it, more so when it is slow, and the
 * detents are wells in its path, deep enough to stop a slow spin in the next one and shallow enough that a fast one
 * clicks through several. All in degrees and seconds.
 */
export const FLY_FRICTION = 2.4;
export const FLY_SLOW_FRICTION = 50;
export const FLY_SLOW_DEG_S = 25;
export const DETENT_PULL = 1400;
/** The fastest a flick may spin it, degrees a second, so a hard throw doesn't whip the world round. */
export const FLY_MAX_DEG_S = 900;
/** Below this speed, within `REST_DEG` of a detent, the knob is at rest. */
export const REST_DEG_S = 1.5;
export const REST_DEG = 0.15;

export interface Spin {
  angle: number;
  speed: number;
}

/** The knob `dt` seconds on (a small step, a few milliseconds): friction and the detents' pull on its angle and speed. */
export function spinStep(s: Spin, dt: number, detent = DETENT_DEG): Spin {
  const slow = FLY_SLOW_FRICTION / (1 + (s.speed / FLY_SLOW_DEG_S) ** 2);
  const pull = DETENT_PULL * Math.sin((2 * Math.PI * s.angle) / detent);
  const speed = s.speed + (-(FLY_FRICTION + slow) * s.speed - pull) * dt;
  return { angle: s.angle + speed * dt, speed };
}

/** Whether a knob is at rest: nearly still and on a detent. */
export function atRest(s: Spin, detent = DETENT_DEG): boolean {
  return Math.abs(s.speed) < REST_DEG_S && Math.abs(s.angle - detentAt(s.angle, detent) * detent) < REST_DEG;
}

/** The speed of a flick, kept within what the knob may spin at. */
export function flick(speed: number): number {
  return Math.max(-FLY_MAX_DEG_S, Math.min(FLY_MAX_DEG_S, speed));
}

/**
 * The eye closes as the reticle nears a place and is shut when one is tuned. `lockOf` turns the distance in screen
 * pixels from the reticle to the nearest place drawn into 0 (far) to 1 (tuned), the same for every place whatever its
 * stories: it says only how near a place is, never which place or how important. Between `LOCK_NEAR`, the map's own
 * tuning radius, and `LOCK_FAR` it eases in smoothly.
 */
export const LOCK_NEAR = 22;
export const LOCK_FAR = 170;

export function lockOf(distPx: number | null, tuned: boolean): number {
  if (tuned) return 1;
  if (distPx === null) return 0;
  const t = Math.min(1, Math.max(0, (LOCK_FAR - distPx) / (LOCK_FAR - LOCK_NEAR)));
  return t * t * (3 - 2 * t);
}

/**
 * What the eye and the static show follows `lockOf` through a low-pass of this time constant, so passing places in
 * quick succession can't make them blink: for a target alternating between 0 and 1 as fast as three times a second the
 * level moves under a third of its range (tested). Reduced motion skips the smoothing and shows only tuned or not.
 */
export const LOCK_TAU_S = 0.3;

export function smoothLock(level: number, target: number, dt: number): number {
  return target + (level - target) * Math.exp(-dt / LOCK_TAU_S);
}

/**
 * The static: a faint grain over the dial window, and over nothing else, drifting slowly (one tile in `STATIC_DRIFT_S`
 * seconds, so its average light never changes) and holding still for reduced motion. Its strength is `STATIC_OPACITY`
 * times the share of the eye that is open, so it thins as a place comes near and is gone once one is tuned.
 */
export const STATIC_OPACITY = 0.42;
export const STATIC_DRIFT_S = 16;

/**
 * The tuning eye: a green disc with a dark wedge that is `EYE_OPEN` degrees wide with nothing near, and two wings that
 * turn in over it until, tuned, `EYE_SHUT` degrees of it show. The disc glows from `LAMP_DIM` to `LAMP_LIT`. It says
 * only that a place is, or is nearly, under the reticle.
 */
export const LAMP_DIM = 0.42;
export const LAMP_LIT = 1;
export const EYE_OPEN = 90;
export const EYE_SHUT = 14;

/** The eye's glow at a lock level. */
export function lampLevel(lock: number): number {
  return LAMP_DIM + (LAMP_LIT - LAMP_DIM) * Math.min(1, Math.max(0, lock));
}

/** The turn of each wing at a lock level, in degrees. */
export function wingAt(lock: number): number {
  return WING_TURN * Math.min(1, Math.max(0, lock));
}

/** Each wing is as wide as it turns, so tuned, the wedge shows only `EYE_SHUT` degrees. */
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

/**
 * The needle rides a cord and lags the reticle a little: it eases over `NEEDLE_EASE_MS`. A jump of more than
 * `NEEDLE_JUMP` of the scale (across the date line, or a press at the far end) skips the easing, so the needle never
 * whips across the whole dial.
 */
export const NEEDLE_EASE_MS = 140;
export const NEEDLE_JUMP = 0.3;

export function needleJumps(from: number, to: number): boolean {
  return Math.abs(to - from) > NEEDLE_JUMP;
}

/**
 * The band switch has one key for each of the map's zoom levels, the whole world first, and the key that stands is
 * the level the map is at, so the zoom buttons, the wheel and a pinch move it as well.
 */
export const BAND_COUNT = 5;

/** The band the map's zoom level is at, kept to the keys there are. */
export function bandOf(level: number): number {
  return Math.min(BAND_COUNT - 1, Math.max(0, Math.round(level)));
}

/** Page Up goes in a band, Page Down out, and neither runs past the ends. */
export function bandStep(band: number, dir: 1 | -1): number {
  return bandOf(band + dir);
}

/**
 * The time knob scrubs the time bar's 96 slots of a quarter hour, one detent each, 5.625 degrees apart, so the whole
 * day is a turn and a half and the two ends point different ways. It is the same control as the slider under the map
 * and is read from it, never the other way round.
 */
export const SLOTS = 96;
export const SLOT_DEG = 5.625;

export function slotOfAngle(angle: number): number {
  return Math.min(SLOTS, Math.max(0, Math.round(angle / SLOT_DEG)));
}

export function angleOfSlot(slot: number): number {
  return Math.min(SLOTS, Math.max(0, slot)) * SLOT_DEG;
}

/** The sound is the reader's to turn on and is off until they do; a click is never closer than this to the last. */
export const CLICK_GAP_MS = 24;
