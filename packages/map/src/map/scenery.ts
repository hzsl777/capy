import { geoDistance, type GeoProjection } from "d3-geo";
import type { Theme, ViewMode } from "../themes.ts";
import { STARS } from "./decor.ts";

/**
 * Scenery that tells four designs apart at a glance (decision 69): lily pads, frogs and dragonflies on the Frog
 * Pond, a moon with a sleeping bear and cups of tea on Bedtime Tea (decision 102), the light through smoke of Thomas Cole's The Course of Empire:
 * Destruction on Course of Empire (id arcadia, whose land shows the painting itself, decision 95), and trick-rope
 * loops, a rope frame and a denim sea
 * on Lasso, and Tarot's gold wheel, sun and moon round the globe. Every piece sits at a fixed
 * spot in open ocean far from land and from every outlet's city (test/scenery.test.ts), or outside the map
 * itself, and none carries text. They are drawn from small SVG pictures, made once and cached.
 */

export type SceneryKind = "pond" | "tea" | "empire" | "rope" | "reef" | "arcana";

export interface Spot {
  kind: string;
  lon: number;
  lat: number;
  /** Degrees of open water around the spot. The picture is drawn this wide, so it never reaches land or a place. */
  r: number;
  flip?: boolean;
}

/** Lily pads, frogs, lotus flowers and dragonflies, spread over every ocean. */
export const POND: readonly Spot[] = [
  { kind: "frog", lon: -142, lat: 10, r: 14 },
  { kind: "lotus", lon: 46, lat: -34, r: 7 },
  { kind: "pads", lon: -38, lat: 26, r: 11 },
  { kind: "dragonfly", lon: -94, lat: -58, r: 9 },
  { kind: "pads", lon: 130, lat: -42, r: 7 },
  { kind: "frog", lon: 154, lat: 30, r: 9, flip: true },
  { kind: "lotus", lon: -22, lat: -30, r: 14 },
  { kind: "dragonfly", lon: -94, lat: -6, r: 9 },
  { kind: "pads", lon: -166, lat: -34, r: 9 },
  { kind: "frog", lon: 90, lat: -10, r: 9 },
  { kind: "lotus", lon: -158, lat: 46, r: 7 },
  { kind: "frog", lon: -126, lat: -26, r: 14, flip: true },
  { kind: "dragonfly", lon: 62, lat: 10, r: 7 },
  { kind: "pads", lon: 6, lat: -58, r: 9 },
];

/**
 * On the flat map the moon with the sleeping bear hangs in the night over the open Pacific, Atlantic and Indian Ocean,
 * and teacups steam and tea bags steep in the open sea between them.
 */
export const TEA: readonly Spot[] = [
  { kind: "bear", lon: -142, lat: 10, r: 14 },
  { kind: "bear", lon: -22, lat: -30, r: 14, flip: true },
  { kind: "bear", lon: 90, lat: -10, r: 9 },
  { kind: "teacup", lon: -38, lat: 26, r: 11 },
  { kind: "teacup", lon: 154, lat: 30, r: 9, flip: true },
  { kind: "teabag", lon: -126, lat: -26, r: 14 },
  { kind: "teabag", lon: 46, lat: -34, r: 7, flip: true },
];

/** Trick-rope loops over the sea. */
export const ROPE: readonly Spot[] = [
  { kind: "lariat", lon: -130, lat: -30, r: 14 },
  { kind: "lariat", lon: 70, lat: -10, r: 10, flip: true },
  { kind: "lariat", lon: -34, lat: 26, r: 9 },
  { kind: "lariat", lon: 162, lat: 42, r: 8, flip: true },
  { kind: "lariat", lon: -14, lat: -54, r: 14 },
  { kind: "lariat", lon: -142, lat: 10, r: 14, flip: true },
];

/**
 * Undersea Town: jellyfish drifting, little reef gardens of coral, kelp and sea grass on patches of sand, and
 * flower-shaped clouds in the water, all drawn for this site. Bubbles rise outside the map, in style.css.
 */
export const REEF: readonly Spot[] = [
  { kind: "jellypink", lon: -142, lat: 10, r: 14 },
  { kind: "garden", lon: -22, lat: -30, r: 14 },
  { kind: "jellylilac", lon: 70, lat: -10, r: 10 },
  { kind: "bloomyellow", lon: 154, lat: 30, r: 9 },
  { kind: "jellypink", lon: -158, lat: 46, r: 7, flip: true },
  { kind: "bloomblue", lon: -38, lat: 26, r: 11 },
  { kind: "garden", lon: -126, lat: -26, r: 14, flip: true },
  { kind: "bloomgreen", lon: 130, lat: -42, r: 7 },
  { kind: "jellylilac", lon: -94, lat: -6, r: 9 },
  { kind: "bloomblue", lon: 6, lat: -58, r: 9, flip: true },
  { kind: "bloompink", lon: -166, lat: -34, r: 9 },
  { kind: "bloomlilac", lon: 46, lat: -34, r: 7 },
  { kind: "bloompink", lon: -94, lat: -58, r: 9, flip: true },
  { kind: "bloomyellow", lon: 90, lat: -10, r: 9 },
  { kind: "jellypink", lon: 62, lat: 10, r: 7, flip: true },
  { kind: "bloomlilac", lon: -171, lat: -60, r: 12 },
  { kind: "jellypink", lon: 93, lat: -51, r: 12, flip: true },
  { kind: "bloomyellow", lon: -93, lat: -33, r: 12 },
  { kind: "bloomgreen", lon: -171, lat: 3, r: 12 },
  { kind: "jellypink", lon: -114, lat: 6, r: 12, flip: true },
  { kind: "garden", lon: -177, lat: 30, r: 12 },
  { kind: "bloompink", lon: 48, lat: -54, r: 11 },
  { kind: "jellylilac", lon: -36, lat: -57, r: 10, flip: true },
  { kind: "bloomgreen", lon: -21, lat: -3, r: 10 },
  { kind: "garden", lon: 102, lat: -27, r: 9 },
  { kind: "jellylilac", lon: -33, lat: 51, r: 9, flip: true },
  { kind: "bloomblue", lon: 144, lat: -57, r: 8 },
  { kind: "bloompink", lon: 66, lat: -30, r: 8 },
  { kind: "bloomlilac", lon: -135, lat: 36, r: 8, flip: true },
  { kind: "jellypink", lon: 6, lat: -39, r: 7 },
  { kind: "bloomblue", lon: 174, lat: 51, r: 6 },
  { kind: "bloomyellow", lon: 3, lat: -21, r: 6, flip: true },
  { kind: "bloompink", lon: -3, lat: -6, r: 6 },
  { kind: "jellylilac", lon: 168, lat: -3, r: 6 },
  { kind: "bloomlilac", lon: -39, lat: 6, r: 6, flip: true },
  { kind: "bloompink", lon: 165, lat: 15, r: 6 },
  { kind: "bloomgreen", lon: 135, lat: 18, r: 6 },
  { kind: "bloomyellow", lon: -153, lat: 30, r: 6, flip: true },
];

const HIDE = (80 * Math.PI) / 180;
const FADE = (62 * Math.PI) / 180;

// ---- pictures ------------------------------------------------------------------------------------------------

/** Lily pad greens: leaf, outline, veins and rim, and the last is an older pad turning bronze. */
const PAD_TONES = [
  ["#5da63e", "#1f4c17", "#8fcc62"],
  ["#4a9434", "#1b4414", "#7cbd55"],
  ["#6db44b", "#24541a", "#a2d875"],
  ["#86a03c", "#44461a", "#bcca72"],
] as const;

/**
 * One lily pad seen from above: a round leaf with the slit that runs from its edge to the stalk at the centre,
 * veins radiating from there, a pale upturned rim and its shadow on the water. `rot` turns the slit (0 is up).
 */
const PAD = (x: number, y: number, r: number, rot: number, tone = 0) => {
  const [fill, edge, light] = PAD_TONES[tone % PAD_TONES.length]!;
  const a = (13 * Math.PI) / 180;
  const pt = (deg: number, f: number) => {
    const t = (deg * Math.PI) / 180;
    return `${(Math.sin(t) * r * f).toFixed(1)} ${(-Math.cos(t) * r * f).toFixed(1)}`;
  };
  const nx = (Math.sin(a) * r).toFixed(1);
  const ny = (-Math.cos(a) * r).toFixed(1);
  const leaf = `M0 ${(r * 0.04).toFixed(1)}L${nx} ${ny}A${r} ${r} 0 1 1 ${-nx} ${ny}Z`;
  const veins = Array.from({ length: 11 }, (_, i) => 30 + i * 30)
    .filter((d) => d < 340)
    .map((d) => `M0 0Q${pt(d - 6, 0.5)} ${pt(d, 0.9)}`)
    .join("");
  const w = Math.max(1.4, r * 0.055).toFixed(1);
  return `<g transform="translate(${x} ${y}) rotate(${rot})">
    <path d="${leaf}" transform="translate(${(r * 0.1).toFixed(1)} ${(r * 0.12).toFixed(1)})" fill="rgba(8,34,22,.42)"/>
    <path d="${leaf}" fill="${fill}"/>
    <path d="M${pt(20, 0.9)}A${r * 0.9} ${r * 0.9} 0 1 1 ${pt(-20, 0.9)}" fill="none" stroke="${light}" stroke-width="${(r * 0.1).toFixed(1)}" opacity=".45"/>
    <path d="${veins}" fill="none" stroke="${light}" stroke-width="${(r * 0.035).toFixed(1)}" stroke-linecap="round" opacity=".75"/>
    <ellipse cx="${(-r * 0.32).toFixed(1)}" cy="${(r * 0.28).toFixed(1)}" rx="${(r * 0.38).toFixed(1)}" ry="${(r * 0.22).toFixed(1)}" transform="rotate(-30 ${(-r * 0.32).toFixed(1)} ${(r * 0.28).toFixed(1)})" fill="#ffffff" opacity=".12"/>
    <path d="${leaf}" fill="none" stroke="${edge}" stroke-width="${w}" stroke-linejoin="round"/>
  </g>`;
};

const RIPPLES = (x: number, y: number, r: number) =>
  `<g fill="none" stroke="#cdeedd" stroke-linecap="round">
    <ellipse cx="${x}" cy="${y}" rx="${r * 1.35}" ry="${r * 1.1}" stroke-width="1.6" opacity=".45" stroke-dasharray="${r * 0.9} ${r * 0.35}"/>
    <ellipse cx="${x}" cy="${y}" rx="${r * 1.7}" ry="${r * 1.4}" stroke-width="1.2" opacity=".25" stroke-dasharray="${r * 0.6} ${r * 0.6}"/>
  </g>`;

/** Half a frog sitting on a pad and facing us: the left thigh folded, shin and long webbed toes, and the arm. */
const FROG_SIDE = `
  <path d="M-12-6C-24-20-46-12-47 4C-48 18-36 24-22 20C-15 16-11 6-12-6Z" fill="#4c9a2c" stroke="#173a10" stroke-width="2" stroke-linejoin="round"/>
  <path d="M-36-4c3-2 7-1 8 2c-2 3-6 3-8-2ZM-26 9c3-1 5 1 5 3c-2 2-5 1-5-3Z" fill="#2c661a"/>
  <path d="M-44 11C-49 24-40 31-27 30L-22 25C-31 25-37 19-38 12Z" fill="#4c9a2c" stroke="#173a10" stroke-width="2" stroke-linejoin="round"/>
  <path d="M-26 28Q-40 28-55 25Q-44 32-55 34Q-44 36-49 42Q-41 38-39 45Q-35 38-30 43Z" fill="#7cba4c" opacity=".35"/>
  <path d="M-26 28Q-40 28-55 25M-26 28Q-42 32-55 34M-26 28Q-40 36-49 42M-26 28Q-34 38-39 45M-26 28Q-28 36-30 43" stroke="#173a10" stroke-width="3.4" stroke-linecap="round" fill="none"/>
  <path d="M-26 28Q-40 28-55 25M-26 28Q-42 32-55 34M-26 28Q-40 36-49 42M-26 28Q-34 38-39 45M-26 28Q-28 36-30 43" stroke="#5aa634" stroke-width="1.5" stroke-linecap="round" fill="none"/>
  <path d="M-13 12C-18 17-19 22-17 27" stroke="#173a10" stroke-width="7.5" stroke-linecap="round" fill="none"/>
  <path d="M-13 12C-18 17-19 22-17 27" stroke="#5aa634" stroke-width="4.5" stroke-linecap="round" fill="none"/>
  <path d="M-17 27l-7 3m7-3l-4 6m4-6l1 6m-1-6l5 4" stroke="#173a10" stroke-width="3.6" stroke-linecap="round"/>
  <path d="M-17 27l-7 3m7-3l-4 6m4-6l1 6m-1-6l5 4" stroke="#5aa634" stroke-width="1.6" stroke-linecap="round"/>`;

/** Its eye: a bulging dome on top of the head with a gold iris and a frog's level pupil. */
const FROG_EYE = `
  <circle cx="-12" cy="-11" r="8" fill="#5aa634" stroke="#173a10" stroke-width="2"/>
  <circle cx="-12" cy="-10.5" r="5.4" fill="#e7bb3c" stroke="#6b4a10" stroke-width="1"/>
  <ellipse cx="-12" cy="-10.5" rx="3.8" ry="1.8" fill="#111"/>
  <path d="M-14.5-13.2l2-.6" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M-20-12.5Q-12-21-4-12.5" stroke="#3f8a25" stroke-width="2.6" fill="none" stroke-linecap="round"/>
  <ellipse cx="-24" cy="-2" rx="3.6" ry="3.2" fill="#3d8424" stroke="#2a5c18" stroke-width="1"/>`;

/**
 * A green frog sitting on a pad, facing us and seen a little from above: a wide flat head with the mouth line
 * across it, bulging eyes on top, a darker spotted back, a pale throat and belly, and folded legs.
 */
const FROG = `<g>
  <ellipse cx="0" cy="31" rx="46" ry="9" fill="rgba(8,34,22,.35)"/>
  ${FROG_SIDE}<g transform="scale(-1 1)">${FROG_SIDE}</g>
  <path d="M-22 0C-27-26-11-38 0-38C11-38 27-26 22 0Z" fill="#3f8a25" stroke="#173a10" stroke-width="2"/>
  <path d="M-13-8C-15-20-11-30-5-34M13-8C15-20 11-30 5-34" stroke="#9bd062" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".8"/>
  <path d="M-6-30c3-2 6 0 5 3c-3 2-6 0-5-3ZM3-33c3-1 5 1 4 3c-2 1-4 0-4-3ZM1-23c2-2 5 0 4 2c-2 2-4 1-4-2Z" fill="#285a17"/>
  <path d="M-15 12C-14 24-8 29 0 29C8 29 14 24 15 12Z" fill="#e6edb8" stroke="#173a10" stroke-width="1.6"/>
  <path d="M-8 20q8 3 16 0M-9 25q9 3 18 0" stroke="#c9d58e" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  <path d="M-27 1C-27-9-15-14 0-14C15-14 27-9 27 1C27 9 15 14 0 14C-15 14-27 9-27 1Z" fill="#5aa634" stroke="#173a10" stroke-width="2"/>
  <path d="M-26 3Q0 13 26 3" stroke="#173a10" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M-26 3Q0 13 26 3" stroke="#c9dd8a" stroke-width="1" fill="none" stroke-linecap="round" transform="translate(0 2.4)" opacity=".8"/>
  <path d="M-5-4l2 1.4M5-4l-2 1.4" stroke="#173a10" stroke-width="1.6" stroke-linecap="round"/>
  ${FROG_EYE}<g transform="scale(-1 1)">${FROG_EYE}</g>
</g>`;

/** A lotus flower open on the water: two rings of pointed petals, pink at the tips, round a golden seed head. */
const LOTUS = (x: number, y: number, s: number) => {
  const petal = (len: number, wid: number, d: number, fill: string, stroke: string) =>
    `<path d="M0 0C${wid} ${-len * 0.3} ${wid * 0.7} ${-len * 0.82} 0 ${-len}C${-wid * 0.7} ${-len * 0.82} ${-wid} ${-len * 0.3} 0 0Z" transform="rotate(${d})" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
  const outer = [0, 45, 90, 135, 180, 225, 270, 315].map((d) => petal(17, 7.5, d, "url(#lp)", "#c24d84")).join("");
  const inner = [22, 67, 112, 157, 202, 247, 292, 337].map((d) => petal(11.5, 5.5, d, "#ffe3ee", "#dd78a6")).join("");
  return `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="3" cy="4" rx="17" ry="15" fill="rgba(8,34,22,.3)"/>${outer}${inner}<circle r="4.4" fill="#f4d24a" stroke="#b98a1c" stroke-width="1"/><path d="M-2-1.5h.1M2-1.5h.1M0 1.8h.1" stroke="#9a7212" stroke-width="1.4" stroke-linecap="round"/></g>`;
};
const LOTUS_DEFS = `<defs><radialGradient id="lp" cx=".5" cy="1" r="1"><stop offset="0" stop-color="#fff2f7"/><stop offset=".6" stop-color="#ffb7d3"/><stop offset="1" stop-color="#ef7fae"/></radialGradient></defs>`;

/** A closed lotus bud standing up out of the water, seen from above. */
const BUD = (x: number, y: number, s: number) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="3" cy="3" rx="6" ry="9" fill="rgba(8,34,22,.3)"/><path d="M0 9C-7 4-7-4 0-10C7-4 7 4 0 9Z" fill="#f59cc2" stroke="#c24d84" stroke-width="1.2"/><path d="M0 9C-3 3-3-4 0-10" stroke="#ffd6e6" stroke-width="1.6" fill="none"/></g>`;

const DRAGONFLY = `<g transform="rotate(-24)">
  <g fill="rgba(215,244,255,.6)" stroke="#2b6f7c" stroke-width="1">
    <ellipse cx="-17" cy="-8" rx="17" ry="5" transform="rotate(-12 -17 -8)"/>
    <ellipse cx="17" cy="-8" rx="17" ry="5" transform="rotate(12 17 -8)"/>
    <ellipse cx="-15" cy="1" rx="15" ry="4.5" transform="rotate(14 -15 1)"/>
    <ellipse cx="15" cy="1" rx="15" ry="4.5" transform="rotate(-14 15 1)"/>
  </g>
  <path d="M0-10L0 30" stroke="#1d5560" stroke-width="5.5" stroke-linecap="round"/>
  <path d="M0-10L0 30" stroke="#35b2c4" stroke-width="3" stroke-linecap="round" stroke-dasharray="3 2"/>
  <circle cx="0" cy="-13" r="4.5" fill="#35b2c4" stroke="#1d5560" stroke-width="1.4"/>
</g>`;

/** The quilt over the sleeping bear: his body under it, its hem hanging over the moon's front. */
const QUILT = "M-30 26C-26 2 10-14 44-6C62-2 74 4 82 4L80 12C62 42 32 55 0 56C-16 56-26 50-30 42Z";
const QUILT_PATCHES = (() => {
  const colours = ["#a9c39a", "#f4ecd6", "#8e9fd8", "#c0433a", "#f4ecd6", "#7f9e74"];
  let out = "";
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 6; j++) out += `<rect x="${-36 + i * 14}" y="${-16 + j * 14}" width="14" height="14" fill="${colours[(i * 2 + j * 3) % colours.length]}"/>`;
  }
  const seams = Array.from({ length: 9 }, (_, i) => `M${-36 + i * 14} -20V64`).join("") + Array.from({ length: 6 }, (_, j) => `M-40 ${-16 + j * 14}H96`).join("");
  return `<g transform="rotate(-8 20 20)">${out}<path d="${seams}" stroke="#fdf8ea" stroke-width="1.2" stroke-dasharray="2.5 2"/></g>`;
})();

/**
 * The bear's head, facing us, asleep: round ears, a pale muzzle, closed eyes, and a red nightcap with a rolled cuff
 * whose long tip flops over to one side and ends in a white pom-pom.
 */
const BEAR_HEAD = `
  <circle cx="-17" cy="-14" r="8" fill="#a2714a" stroke="#4a2e1a" stroke-width="2.2"/><circle cx="-17" cy="-14" r="4.2" fill="#e6c9a0"/>
  <circle cx="17" cy="-14" r="8" fill="#a2714a" stroke="#4a2e1a" stroke-width="2.2"/><circle cx="17" cy="-14" r="4.2" fill="#e6c9a0"/>
  <ellipse cx="0" cy="0" rx="22" ry="20" fill="#a2714a" stroke="#4a2e1a" stroke-width="2.5"/>
  <ellipse cx="0" cy="8" rx="11" ry="8" fill="#ecd4ae" stroke="#4a2e1a" stroke-width="1.6"/>
  <path d="M-4.5 3.5Q0 0.5 4.5 3.5Q2.5 7.5 0 7.5Q-2.5 7.5-4.5 3.5Z" fill="#3a2414"/>
  <path d="M0 7.5v2.5M-4 10.5q2 2.2 4 0q2 2.2 4 0" stroke="#3a2414" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  <path d="M-14-1q4 4 8 0M6-1q4 4 8 0" stroke="#3a2414" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <ellipse cx="-14" cy="6" rx="4" ry="2.6" fill="#e8978a" opacity=".55"/><ellipse cx="14" cy="6" rx="4" ry="2.6" fill="#e8978a" opacity=".55"/>
  <path d="M-8-38C-30-46-50-32-54-2C-49-12-43-22-30-26C-22-28-17-26-13-21Z" fill="#b8352c" stroke="#6e1c15" stroke-width="2" stroke-linejoin="round"/>
  <path d="M-19-14C-22-34-6-46 10-42C22-38 24-26 20-14Z" fill="#c9413a" stroke="#6e1c15" stroke-width="2" stroke-linejoin="round"/>
  <path d="M-4-40C0-32 6-26 15-21M-40-30C-46-24-50-14-52-6" stroke="#8f261f" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>
  <path d="M-23-11C-21-21 21-21 23-11C21-4-21-4-23-11Z" fill="#a52d25" stroke="#6e1c15" stroke-width="1.8"/>
  <path d="M-19-10.5C-12-15 12-15 19-10.5" stroke="#d9695d" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <circle cx="-54" cy="0" r="7.5" fill="#fbf5e6" stroke="#8d8068" stroke-width="1.6"/>
  <path d="M-59 2.5q5 4 10-.5" stroke="#c7cfe8" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;

/** Bedtime Tea's teacup seen from the side: a wide rim rounding down to a small foot. */
const TEACUP_BODY = "M-47-14L47-14C47 18 30 38 0 38C-30 38-47 18-47-14Z";

/** A chamomile flower: white petals round a yellow middle, stroked so it reads as a flower at any size. */
const CHAMOMILE = (x: number, y: number, s: number) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><g fill="#fffdf6" stroke="#b9b49a" stroke-width=".9">${[0, 40, 80, 120, 160, 200, 240, 280, 320]
    .map((d) => `<ellipse cx="0" cy="-7" rx="2.6" ry="5.2" transform="rotate(${d})"/>`)
    .join("")}</g><circle r="3.6" fill="#f2c84a" stroke="#c99a26" stroke-width="1"/></g>`;

// Undersea Town. A flower-shaped cloud: one outline of round petals, a paler flower inside it and a soft middle,
// cut as a single path so no part of it reads as a round dot.
const FLOWER_PATH = (r: number, petals: number, rot: number) => {
  const step = (2 * Math.PI) / petals;
  const valley = r * 0.62;
  const chord = 2 * valley * Math.sin(step / 2);
  const pr = (chord * 0.62).toFixed(1);
  const pt = (i: number) => {
    const a = (rot * Math.PI) / 180 + i * step;
    return `${(Math.cos(a) * valley).toFixed(1)} ${(Math.sin(a) * valley).toFixed(1)}`;
  };
  let d = `M${pt(0)}`;
  for (let i = 1; i <= petals; i++) d += `A${pr} ${pr} 0 1 1 ${pt(i)}`;
  return `${d}Z`;
};
const BLOOM = (x: number, y: number, r: number, petals: number, rot: number, [edge, mid, core]: readonly [string, string, string]) =>
  `<g transform="translate(${x} ${y})" stroke-linejoin="round">
    <path d="${FLOWER_PATH(r, petals, rot)}" fill="${mid}" stroke="${edge}" stroke-width="${Math.max(2, r * 0.09).toFixed(1)}"/>
    <path d="${FLOWER_PATH(r * 0.56, petals, rot + 180 / petals)}" transform="translate(${(-r * 0.06).toFixed(1)} ${(-r * 0.08).toFixed(1)})" fill="${core}"/>
  </g>`;
const BLOOMS: Record<string, readonly [string, string, string]> = {
  blue: ["#2f8fd8", "#8fd0ff", "#e4f5ff"],
  pink: ["#e0518f", "#ffadd0", "#fff0f6"],
  green: ["#2fa85a", "#94e6a2", "#eafbe9"],
  lilac: ["#8a5fd6", "#cdb3fb", "#f5efff"],
  yellow: ["#e0a412", "#ffe27a", "#fffbe2"],
};

/** A thin trail of bubbles rising from a point: rings with a glint, larger as they rise. */
const BUBBLES = (x: number, y: number) =>
  `<g fill="rgba(230,252,255,.25)" stroke="#e9fdff" stroke-width="1.6">
    <circle cx="${x}" cy="${y}" r="2.6"/><circle cx="${x + 5}" cy="${y - 10}" r="3.6"/><circle cx="${x - 2}" cy="${y - 23}" r="4.8"/><circle cx="${x + 6}" cy="${y - 38}" r="6"/>
  </g>
  <path d="M${x - 4.4} ${y - 24}a3 3 0 0 1 2.4-2.6M${x + 2.4} ${y - 40}a4 4 0 0 1 3-3" stroke="#ffffff" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;

/**
 * A jellyfish drifting: a round bell with a frilled hem, a paler inside and a shine, two ruffled arms and four long
 * wavy tentacles trailing below. 64 wide and about 110 tall at scale 1, the bell's top at y = -36. No face.
 */
const JELLY = (x: number, y: number, s: number, rot: number, [body, light, edge]: readonly [string, string, string]) => {
  const hem = "q-2.5 6-5 0".repeat(12);
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" stroke-linecap="round" stroke-linejoin="round">
    <g fill="none">
      <path d="M-20 6c-7 10 5 18-2 28s5 18-2 28s5 14 0 22M20 6c7 10-5 18 2 28s-5 18 2 28s-5 14 0 22M-9 7c-5 12 6 20 0 32s6 20 0 32M9 7c5 12-6 20 0 32s-6 20 0 32" stroke="${edge}" stroke-width="4.6"/>
      <path d="M-20 6c-7 10 5 18-2 28s5 18-2 28s5 14 0 22M20 6c7 10-5 18 2 28s-5 18 2 28s-5 14 0 22M-9 7c-5 12 6 20 0 32s6 20 0 32M9 7c5 12-6 20 0 32s-6 20 0 32" stroke="${light}" stroke-width="2.2"/>
      <path d="M-3 6c-6 6 4 10-2 17s4 10-1 17M3 6c6 6-4 10 2 17s-4 10 1 17" stroke="${edge}" stroke-width="9"/>
      <path d="M-3 6c-6 6 4 10-2 17s4 10-1 17M3 6c6 6-4 10 2 17s-4 10 1 17" stroke="${body}" stroke-width="5.6"/>
    </g>
    <path d="M-30 6C-32-20-18-36 0-36S32-20 30 6${hem}Z" fill="${body}" stroke="${edge}" stroke-width="3"/>
    <path d="M-22 2C-22-14-12-24 0-24S22-14 22 2C14-2-14-2-22 2Z" fill="${light}" opacity=".75"/>
    <path d="M-20-16C-16-26-8-31 2-31" stroke="#ffffff" stroke-width="4" fill="none" opacity=".8"/>
  </g>`;
};
const JELLIES: Record<string, readonly [string, string, string]> = {
  pink: ["#ff9ccb", "#ffe0ef", "#c2306e"],
  lilac: ["#c9a2f5", "#f1e6ff", "#6f3cb0"],
};

/** A starfish lying on the sand: five soft arms with a pale line down each, no face. */
const STARFISH = (x: number, y: number, s: number, rot: number) => {
  const arm = (i: number) => {
    const a = ((i * 72 - 90) * Math.PI) / 180;
    const b = ((i * 72 - 54) * Math.PI) / 180;
    return `${i === 0 ? "M" : "L"}${(Math.cos(a) * 22).toFixed(1)} ${(Math.sin(a) * 22).toFixed(1)}Q${(Math.cos(a) * 12 + Math.cos(b) * 2).toFixed(1)} ${(Math.sin(a) * 12 + Math.sin(b) * 2).toFixed(1)} ${(Math.cos(b) * 8).toFixed(1)} ${(Math.sin(b) * 8).toFixed(1)}`;
  };
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" stroke-linejoin="round" stroke-linecap="round">
    <path d="${[0, 1, 2, 3, 4].map(arm).join("")}Z" fill="#ff9a3c" stroke="#a8461a" stroke-width="3"/>
    <path d="${[0, 1, 2, 3, 4].map((i) => {
      const a = ((i * 72 - 90) * Math.PI) / 180;
      return `M0 0L${(Math.cos(a) * 15).toFixed(1)} ${(Math.sin(a) * 15).toFixed(1)}`;
    }).join("")}" stroke="#ffd29a" stroke-width="2.6" fill="none"/>
  </g>`;
};

/** A scallop shell: a fan of ribs from a little hinge. */
const SCALLOP = (x: number, y: number, s: number, rot: number) =>
  `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" stroke-linejoin="round" stroke-linecap="round">
    <path d="M-4 10h8l3 4h-14Z" fill="#f7b6a0" stroke="#a24c3c" stroke-width="2.2"/>
    <path d="M0 10L-18-2C-20-12-12-20 0-20S20-12 18-2Z" fill="#ffd3c2" stroke="#a24c3c" stroke-width="2.6"/>
    <path d="M0 10L-12-15M0 10L-5-19M0 10L5-19M0 10L12-15M0 10L17-5M0 10L-17-5" stroke="#e48a72" stroke-width="2" fill="none"/>
  </g>`;

/** Branching coral: thick rounded branches in two tones. */
const CORAL = (x: number, y: number, s: number, [fill, edge, light]: readonly [string, string, string]) => {
  const d = "M0 0V-22M0-10C-8-14-12-20-12-30M-12-22C-18-24-20-28-20-34M0-18C6-24 12-26 12-36M12-28C18-30 20-34 20-40M0-22C-2-30 2-34 2-42";
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="${d}" stroke="${edge}" stroke-width="10"/>
    <path d="${d}" stroke="${fill}" stroke-width="6.4"/>
    <path d="M-12-26V-30M12-32V-36M2-36V-40" stroke="${light}" stroke-width="2.4"/>
  </g>`;
};

/** A fan coral: a lacy fan on a short stalk. */
const FAN = (x: number, y: number, s: number) =>
  `<g transform="translate(${x} ${y}) scale(${s})" stroke-linecap="round" stroke-linejoin="round">
    <path d="M0 0V-8C-22-10-30-28-24-42C-14-52 14-52 24-42C30-28 22-10 0-8" fill="#c38af0" stroke="#5e2d94" stroke-width="3"/>
    <path d="M0-8L-16-40M0-8L-6-46M0-8L6-46M0-8L16-40M0-8L-22-28M0-8L22-28M-20-36Q0-26 20-36M-14-22Q0-16 14-22" stroke="#e9d4ff" stroke-width="1.8" fill="none"/>
  </g>`;

/** A frond of kelp swaying up from the sand, with its leaves. */
const KELP = (x: number, y: number, s: number, flip = false) => {
  const stem = "M0 0C-8-16 8-30 0-46S8-74 0-90";
  const leaves = "M-1-18C-12-20-18-28-16-36C-8-32-2-26-1-18ZM3-40C14-42 20-50 18-58C10-54 4-48 3-40ZM-1-64C-12-66-16-74-14-82C-6-78-2-72-1-64Z";
  return `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})" stroke-linecap="round" stroke-linejoin="round">
    <path d="${stem}" fill="none" stroke="#145c2c" stroke-width="7"/>
    <path d="${stem}" fill="none" stroke="#3fb85a" stroke-width="4"/>
    <path d="${leaves}" fill="#5ccf6e" stroke="#145c2c" stroke-width="2.4"/>
  </g>`;
};

/** A tuft of sea grass. */
const GRASS = (x: number, y: number, s: number) =>
  `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke-linecap="round">
    <path d="M0 0C-2-10-8-16-10-26M3 0C4-12 0-20 4-32M6 0C9-8 14-12 16-20" stroke="#1e7a3c" stroke-width="5"/>
    <path d="M0 0C-2-10-8-16-10-26M3 0C4-12 0-20 4-32M6 0C9-8 14-12 16-20" stroke="#7ad86a" stroke-width="2.6"/>
  </g>`;

/**
 * A little reef on a patch of sand: branching coral, a fan, kelp and sea grass, with a starfish and a scallop shell
 * lying in front. A garden, not a dwelling: nothing in it has a door or a window.
 */
const GARDEN = `<path d="M-90 56C-70 30-36 24 0 24S70 30 90 56Z" fill="#f4d998" stroke="#b58646" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M-56 46q4-2 8 0M34 44q5-2 9 0M-14 50q4-2 7 0M60 50q3-2 6 0" stroke="#c89c5c" stroke-width="2" fill="none" stroke-linecap="round"/>
  ${KELP(-58, 40, 0.95)}
  ${KELP(64, 40, 0.8, true)}
  ${FAN(-22, 32, 1.05)}
  ${CORAL(22, 32, 1.25, ["#ff7a59", "#a8321c", "#ffc3a8"])}
  ${CORAL(-40, 38, 0.8, ["#ffd23f", "#a8741a", "#fff1a8"])}
  ${GRASS(44, 40, 1)}
  ${GRASS(-74, 48, 0.8)}
  ${STARFISH(-4, 46, 0.62, 12)}
  ${SCALLOP(42, 50, 0.6, -14)}
  ${BUBBLES(26, -24)}`;

const svg = (vb: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="400" height="${Math.round((400 * Number(vb.split(" ")[3])) / Number(vb.split(" ")[2]))}">${body}</svg>`;

export const PICTURES: Record<string, string> = {
  // Pond: each picture is 200 by 140, centred. Pads keep open water between them and overlap only as one leaf
  // lying on another, so each reads as its own leaf.
  frog: svg("-100 -70 200 140", `${RIPPLES(0, 6, 46)}${PAD(74, -44, 15, 60, 1)}${PAD(0, 8, 50, 140)}<g transform="translate(0 -2) scale(1.02)">${FROG}</g>`),
  lotus: svg(
    "-100 -70 200 140",
    `${LOTUS_DEFS}${RIPPLES(-10, 2, 40)}${PAD(56, 36, 19, -70, 1)}${PAD(-72, -42, 13, 120, 3)}${PAD(-10, 4, 40, 205)}${LOTUS(-14, -2, 1.3)}`,
  ),
  pads: svg(
    "-100 -70 200 140",
    `${RIPPLES(0, 0, 40)}${PAD(-42, -14, 29, 35)}${PAD(-20, 18, 16, 250, 3)}${PAD(22, -32, 20, 170, 1)}${PAD(44, 22, 26, 300, 2)}${BUD(26, -34, 1)}`,
  ),
  dragonfly: svg(
    "-100 -70 200 140",
    `${RIPPLES(-24, 26, 18)}${PAD(-24, 26, 19, 120, 1)}${PAD(-66, -26, 11, 30, 2)}<ellipse cx="14" cy="18" rx="26" ry="8" fill="rgba(10,40,25,.25)"/><g transform="translate(14 -10) scale(1.3)">${DRAGONFLY}</g>`,
  ),

  // Bedtime Tea: a bear asleep in a red nightcap with a pom-pom, lying in a crescent moon with his head on a pillow
  // under a patchwork quilt that hangs over the moon's edge. Our own drawing, in the palette of a bedtime tea box
  // (periwinkle, sage, cream and a warm red). 240 by 180.
  bear: svg(
    "-120 -90 240 180",
    `<defs><radialGradient id="g"><stop offset="0" stop-color="#fff6d2" stop-opacity=".75"/><stop offset=".6" stop-color="#e9ecff" stop-opacity=".25"/><stop offset="1" stop-color="#e9ecff" stop-opacity="0"/></radialGradient>
    <linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff5cf"/><stop offset="1" stop-color="#f3d98c"/></linearGradient>
    <clipPath id="q"><path d="${QUILT}"/></clipPath></defs>
    <circle cx="0" cy="8" r="90" fill="url(#g)"/>
    <path d="M-84-6A84 70 0 0 0 84-6A86 46 0 0 1-84-6Z" fill="url(#m)" stroke="#cfa94e" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M-70 20A80 58 0 0 0 30 58" stroke="#fffbe8" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7"/>
    <g transform="translate(-60 16) rotate(-18)"><ellipse rx="22" ry="12" fill="#f7f1e3" stroke="#6f7fa8" stroke-width="2"/><path d="M-14-6v12M-4-10v20M6-10v20M15-6v12" stroke="#b7c4e8" stroke-width="2.2" stroke-linecap="round"/></g>
    <g clip-path="url(#q)">${QUILT_PATCHES}</g>
    <path d="${QUILT}" fill="none" stroke="#4d5a82" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M80 12C62 42 32 55 0 56C-16 56-26 50-30 42" fill="none" stroke="#c0433a" stroke-width="4" stroke-linecap="round"/>
    <g transform="translate(-44 0) rotate(-12)">${BEAR_HEAD}</g>
    <g transform="translate(-16 16) rotate(-10)"><ellipse rx="10" ry="7.5" fill="#a2714a" stroke="#4a2e1a" stroke-width="2.2"/><path d="M-4-6v4M1-7v4M6-5v4" stroke="#4a2e1a" stroke-width="1.6" stroke-linecap="round"/></g>
    <path d="M34-58l0 10m-5-5l10 0M86-46l0 8m-4-4l8 0M-92-54l0 8m-4-4l8 0M60-78l0 6m-3-3l6 0" stroke="#fff6c8" stroke-width="2.2" stroke-linecap="round"/>`,
  ),

  // Bedtime Tea: a teacup of our own on its saucer at sea, steam curling up, a chamomile flower painted on the cup.
  // 200 by 140.
  teacup: svg(
    "-100 -70 200 140",
    `<defs><linearGradient id="cg" x1="0" x2="1"><stop offset="0" stop-color="#fffaf0"/><stop offset=".55" stop-color="#f6eedb"/><stop offset="1" stop-color="#dcd0b4"/></linearGradient>
    <linearGradient id="tea" x1="0" x2="1"><stop offset="0" stop-color="#b8742c"/><stop offset=".5" stop-color="#d9963e"/><stop offset="1" stop-color="#e9b45c"/></linearGradient>
    <clipPath id="cb"><path d="${TEACUP_BODY}"/></clipPath></defs>
    <ellipse cx="0" cy="46" rx="86" ry="18" fill="none" stroke="#c8d2ff" stroke-width="1.6" opacity=".35"/>
    <ellipse cx="4" cy="50" rx="72" ry="14" fill="rgba(10,15,50,.35)"/>
    <ellipse cx="0" cy="44" rx="72" ry="14" fill="#f7f1e1" stroke="#4d5a82" stroke-width="2.2"/>
    <ellipse cx="0" cy="44" rx="63" ry="11" fill="none" stroke="#8e9fd8" stroke-width="2.4"/>
    <ellipse cx="0" cy="42" rx="40" ry="7.5" fill="#e6dcc0"/>
    <path d="M42-6C70-12 74 24 34 28" fill="none" stroke="#4d5a82" stroke-width="10" stroke-linecap="round"/>
    <path d="M42-6C70-12 74 24 34 28" fill="none" stroke="#f6eedb" stroke-width="5.5" stroke-linecap="round"/>
    <path d="${TEACUP_BODY}" fill="url(#cg)"/>
    <g clip-path="url(#cb)"><rect x="-60" y="-1" width="120" height="8" fill="#8e9fd8"/><rect x="-60" y="9" width="120" height="2.4" fill="#c0433a"/></g>
    ${CHAMOMILE(-16, 24, 0.9)}
    <path d="${TEACUP_BODY}" fill="none" stroke="#4d5a82" stroke-width="2.4" stroke-linejoin="round"/>
    <ellipse cx="0" cy="-14" rx="47" ry="9" fill="#fffaf0" stroke="#4d5a82" stroke-width="2.2"/>
    <ellipse cx="0" cy="-13.2" rx="40" ry="6" fill="url(#tea)"/>
    <path d="M-26-15q10-3 22-2" stroke="#ffe2a8" stroke-width="1.8" fill="none" stroke-linecap="round" opacity=".8"/>
    <g fill="none" stroke="#fffaf0" stroke-linecap="round" opacity=".75">
      <path d="M-16-26C-28-38-6-46-18-60" stroke-width="3.6"/>
      <path d="M2-28C-10-42 14-50 2-66" stroke-width="4"/>
      <path d="M20-25C10-36 30-42 22-56" stroke-width="3.2"/>
    </g>`,
  ),

  // Bedtime Tea: a tea bag steeping in the sea, the tea clouding out round it in amber swirls, its string running
  // up to a blank paper tag with a little crescent on it. No lettering. 200 by 140.
  teabag: svg(
    "-100 -70 200 140",
    `<defs><radialGradient id="tg"><stop offset="0" stop-color="#d9963e" stop-opacity=".7"/><stop offset=".55" stop-color="#c98436" stop-opacity=".32"/><stop offset="1" stop-color="#c98436" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="-4" cy="18" rx="80" ry="40" fill="url(#tg)"/>
    <ellipse cx="-50" cy="34" rx="40" ry="20" fill="url(#tg)"/>
    <ellipse cx="46" cy="22" rx="36" ry="20" fill="url(#tg)"/>
    <g fill="none" stroke="#efc27a" stroke-linecap="round" opacity=".7" stroke-width="2.2">
      <path d="M-58 22c-10 10 6 22 18 12s-2-20-10-10"/>
      <path d="M30 34c14 6 30-4 22-14s-20 2-12 8"/>
      <path d="M-30 46c10 6 26 4 34-4"/>
    </g>
    <ellipse cx="-6" cy="22" rx="40" ry="12" fill="none" stroke="#dfe6ff" stroke-width="1.6" opacity=".4"/>
    <path d="M-4-36C10-58 34-60 52-50" fill="none" stroke="#efe6cf" stroke-width="1.8"/>
    <g transform="rotate(14 60 -46)">
      <rect x="46" y="-58" width="28" height="22" rx="2.5" fill="#fbf6e8" stroke="#b8945a" stroke-width="1.8"/>
      <path d="M64-52A7 7 0 1 0 64-40A5.5 5.5 0 1 1 64-52Z" fill="none" stroke="#6f7fc0" stroke-width="1.6" stroke-linejoin="round"/>
    </g>
    <g transform="rotate(-12)">
      <path d="M-24-22L-4-36L16-22Z" fill="#efe2c4" stroke="#8a7350" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M-24-22H16V28H-24Z" fill="#f3e8cf" stroke="#8a7350" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M-24-17H16M-24 23H16" stroke="#c9b48c" stroke-width="2.4" stroke-dasharray="1.6 1.6"/>
      <path d="M-16-8l4 2M-2-10l3 3M8-4l-3 3M-12 4l4-1M2 6l3 2M-6 14l3-2M10 12l-3 3M-18 16l3 1" stroke="#8a6a3a" stroke-width="1.6" stroke-linecap="round" opacity=".6"/>
      <path d="M-24 6q10-4 20 0t20 0V28H-24Z" fill="#c98436" opacity=".38"/>
      <path d="M-28 6q12-5 24 0t24 0" fill="none" stroke="#dfe6ff" stroke-width="1.6" opacity=".6"/>
      <rect x="-6.5" y="-33" width="5" height="3" rx=".6" fill="#b9bfcc"/>
    </g>`,
  ),

  // Tarot: a sun with straight and wavy rays and a crescent moon, gold line work as on the cards. No faces. 120 by 120.
  sun: svg(
    "-60 -60 120 120",
    `<g fill="#e3bd62">${[...Array(12).keys()].map((i) => `<path d="M-4-27L0-54L4-27Z" transform="rotate(${i * 30})"/>`).join("")}</g>
    <g fill="none" stroke="#e3bd62" stroke-width="2" stroke-linecap="round">${[...Array(12).keys()].map((i) => `<path d="M0-27C5-33-5-39 0-46" transform="rotate(${i * 30 + 15})"/>`).join("")}</g>
    <circle r="24" fill="#f5e6c0" stroke="#e3bd62" stroke-width="3"/>
    <circle r="17" fill="none" stroke="#c9973a" stroke-width="1.4"/>
    <path d="M0-12L3-3L12 0L3 3L0 12L-3 3L-12 0L-3-3Z" fill="none" stroke="#c9973a" stroke-width="1.4" stroke-linejoin="round"/>`,
  ),
  moon: svg(
    "-60 -60 120 120",
    `<path d="M8-42A42 42 0 1 0 8 42A33 33 0 1 1 8-42Z" fill="#f5e6c0" stroke="#e3bd62" stroke-width="3" stroke-linejoin="round"/>
    <path d="M-2-30A32 32 0 0 0-2 30" fill="none" stroke="#c9973a" stroke-width="1.4"/>
    <g fill="none" stroke="#f5e6c0" stroke-width="1.6" stroke-linejoin="round"><path d="M34-30Q34-24 40-24Q34-24 34-18Q34-24 28-24Q34-24 34-30Z"/><path d="M40 16Q40 21 45 21Q40 21 40 26Q40 21 35 21Q40 21 40 16Z"/></g>`,
  ),

  // Lasso: a spinning loop with its knot and the rope running off, with motion lines. 200 by 120.
  lariat: svg(
    "-100 -60 200 120",
    `<g fill="none" stroke-linecap="round">
    <path d="M-86-6A80 26 0 0 1 -40-30M86 10A80 26 0 0 1 50 30M-70 22A70 20 0 0 0 -30 34" stroke="#f3e6c8" stroke-width="2" opacity=".6"/>
    <ellipse cx="0" cy="0" rx="70" ry="22" stroke="#5a3a1c" stroke-width="8"/>
    <ellipse cx="0" cy="0" rx="70" ry="22" stroke="#d6b27a" stroke-width="5.5"/>
    <ellipse cx="0" cy="0" rx="70" ry="22" stroke="#8a5e2c" stroke-width="5.5" stroke-dasharray="3 4"/>
    <path d="M58 12C72 26 64 42 44 48C24 54 10 44 -6 52" stroke="#5a3a1c" stroke-width="8"/>
    <path d="M58 12C72 26 64 42 44 48C24 54 10 44 -6 52" stroke="#d6b27a" stroke-width="5.5"/>
    <path d="M58 12C72 26 64 42 44 48C24 54 10 44 -6 52" stroke="#8a5e2c" stroke-width="5.5" stroke-dasharray="3 4"/>
    <ellipse cx="60" cy="12" rx="7" ry="5" fill="#b88a52" stroke="#5a3a1c" stroke-width="2.5"/>
    </g>`,
  ),

  // Undersea Town: jellyfish 200 by 160, a reef garden on its sand 200 by 140, and flower clouds 200 by 140 (two
  // flowers of different colours, neither small enough to read as a dot).
  ...Object.fromEntries(
    Object.entries(JELLIES).map(([name, c]) => [
      `jelly${name}`,
      svg("-100 -80 200 160", `${JELLY(-40, -12, 1.15, -8, c)}${JELLY(34, -34, 0.8, 10, c)}${JELLY(52, 30, 0.6, -4, c)}`),
    ]),
  ),
  garden: svg("-100 -70 200 140", GARDEN),
  ...Object.fromEntries(
    (
      [
        ["blue", "pink"],
        ["pink", "yellow"],
        ["green", "lilac"],
        ["lilac", "green"],
        ["yellow", "blue"],
      ] as const
    ).map(([big, small]) => [
      `bloom${big}`,
      svg("-100 -70 200 140", `${BLOOM(-24, -4, 50, 6, 10, BLOOMS[big]!)}${BLOOM(50, 30, 30, 5, -20, BLOOMS[small]!)}`),
    ]),
  ),
};

const cache = new Map<string, HTMLImageElement>();
function picture(kind: string, ready: () => void): HTMLImageElement | null {
  const src = PICTURES[kind];
  if (!src) return null;
  let im = cache.get(kind);
  if (!im) {
    im = new Image();
    im.onload = ready;
    im.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`;
    cache.set(kind, im);
  }
  return im.complete && im.naturalWidth > 0 ? im : null;
}

// ---- drawing -------------------------------------------------------------------------------------------------

export interface SceneryFrame {
  ctx: CanvasRenderingContext2D;
  proj: GeoProjection;
  theme: Theme;
  mode: ViewMode;
  center: [number, number];
  w: number;
  h: number;
  /** The land as drawn this frame, when there is one. */
  land: Path2D | null;
  /** Draws the sheet's or the sphere's outline as the current path. */
  outline: () => void;
  /** Asks for another frame once a picture has loaded. */
  redraw: () => void;
}

/** Under the land, over the sea: Course of Empire's light through smoke and Lasso's denim. Inside the sphere's clip. */
export function drawSceneryUnder(f: SceneryFrame) {
  const { ctx, theme: t, mode, w, h } = f;
  if (t.scenery === "empire") {
    // As in Destruction, pale light breaks through the smoke at the upper right and the far water darkens under it.
    const R = f.proj.scale();
    const [cx, cy] = f.proj.translate();
    const sx = mode === "3d" ? cx + R * 0.45 : w * 0.72;
    const sy = mode === "3d" ? cy - R * 0.55 : Math.max(0, cy - R * 1.2);
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(w, h) * 0.9);
    g.addColorStop(0, "rgba(255,255,255,0.34)");
    g.addColorStop(0.4, "rgba(255,255,255,0.1)");
    g.addColorStop(1, "rgba(0,0,0,0.28)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else if (t.scenery === "rope") {
    ctx.fillStyle = denim(ctx);
    ctx.fillRect(0, 0, w, h);
  } else if (t.scenery === "tea") {
    // A watercolour night: a paler periwinkle wash from the moon's side, pooling darker toward the bottom.
    const g = ctx.createRadialGradient(w * 0.8, 0, 0, w * 0.8, 0, Math.max(w, h) * 1.1);
    g.addColorStop(0, "rgba(160,176,236,0.45)");
    g.addColorStop(0.5, "rgba(128,146,214,0.18)");
    g.addColorStop(1, "rgba(34,42,92,0.3)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (mode === "3d") {
      // The globe is the tea in the cup: warm amber where the tea meets the cup's wall, under the land.
      const R = f.proj.scale();
      const [cx, cy] = f.proj.translate();
      const tea = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
      tea.addColorStop(0, "rgba(214,150,62,0)");
      tea.addColorStop(0.75, "rgba(214,150,62,0.3)");
      tea.addColorStop(1, "rgba(196,128,46,0.72)");
      ctx.fillStyle = tea;
      ctx.fillRect(0, 0, w, h);
    }
  } else if (t.scenery === "reef") sunlit(f);
}

/** Over the land, under the dots. */
export function drawScenery(f: SceneryFrame) {
  const t = f.theme;
  if (t.scenery === "pond") drawSpots(f, POND, 0.95);
  else if (t.scenery === "arcana") wheel(f);
  else if (t.scenery === "reef") drawSpots(f, REEF, 0.95, 24);
  else if (t.scenery === "rope") {
    seam(f);
    drawSpots(f, ROPE, 0.95);
    ropeFrame(f);
  } else if (t.scenery === "tea") {
    stars(f);
    const saucer = f.mode === "3d" ? teacup(f) : 0;
    steam(f, saucer > 0);
    moon(f, saucer);
  }
}

/**
 * Bedtime Tea's globe as the tea in a big cup seen from above: the saucer with a periwinkle band, the cup's inner
 * wall and rim round the sphere, the handle on the right, and a spoon, a honey dipper with its drip and two chamomile
 * flowers on the saucer. Everything lies outside the sphere, so nothing covers a place. Returns the saucer's radius,
 * or 0 when the globe is zoomed in past the frame and there is no room for any of it.
 */
function teacup(f: SceneryFrame): number {
  const { ctx, proj, w, h } = f;
  const R = proj.scale();
  const [cx, cy] = proj.translate();
  // Zoomed in so far that the cup's rim would not show anywhere in the frame.
  if (Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) < R * 1.02) return 0;
  const rim = R * 1.12;
  const saucer = R * 1.42;
  const line = Math.max(1.2, R * 0.009);
  const TAU = Math.PI * 2;
  ctx.save();
  // Never paint over the globe: the frame with the sphere cut out.
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.arc(cx, cy, R + 0.5, 0, TAU);
  ctx.clip("evenodd");

  // The saucer's soft shadow, then the saucer: cream china with a gold edge, a periwinkle band and the well.
  const sh = ctx.createRadialGradient(cx + R * 0.05, cy + R * 0.08, saucer * 0.9, cx + R * 0.05, cy + R * 0.08, saucer * 1.08);
  sh.addColorStop(0, "rgba(10,14,48,0.4)");
  sh.addColorStop(1, "rgba(10,14,48,0)");
  ctx.fillStyle = sh;
  ctx.fillRect(0, 0, w, h);
  const china = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.5, R * 0.2, cx, cy, saucer);
  china.addColorStop(0, "#fffcf3");
  china.addColorStop(0.75, "#f6eedb");
  china.addColorStop(1, "#e4d7b8");
  ctx.beginPath();
  ctx.arc(cx, cy, saucer, 0, TAU);
  ctx.fillStyle = china;
  ctx.fill();
  ctx.lineWidth = line * 1.6;
  ctx.strokeStyle = "#b8945a";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, saucer * 0.95, 0, TAU);
  ctx.lineWidth = R * 0.03;
  ctx.strokeStyle = "#8e9fd8";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, saucer * 0.95 - R * 0.026, 0, TAU);
  ctx.lineWidth = line * 0.7;
  ctx.strokeStyle = "#d6b16a";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.2, 0, TAU);
  ctx.lineWidth = R * 0.016;
  ctx.strokeStyle = "rgba(150,128,88,0.28)";
  ctx.stroke();

  // Things laid on the saucer, round the cup: a spoon at the lower left, a honey dipper at the lower right with honey
  // pooled under it, chamomile at the left. Each is drawn along the saucer's band, at an angle round the centre.
  const band = (rim + saucer * 0.95) / 2;
  const lay = (angle: number, draw: () => void) => {
    ctx.save();
    ctx.translate(cx + Math.cos(angle) * band, cy + Math.sin(angle) * band);
    ctx.rotate(angle + Math.PI / 2);
    ctx.scale(R / 100, R / 100);
    draw();
    ctx.restore();
  };
  lay(2.25, () => {
    // A teaspoon, its bowl to one side and its handle tapering away.
    ctx.beginPath();
    ctx.moveTo(-6, -1.6);
    ctx.quadraticCurveTo(14, -2.6, 30, -1.2);
    ctx.lineTo(30, 1.2);
    ctx.quadraticCurveTo(14, 2.6, -6, 1.6);
    ctx.closePath();
    ctx.fillStyle = "rgba(10,14,48,0.18)";
    ctx.save();
    ctx.translate(1.5, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-15, 0, 10, 6.4, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#e3e7f1";
    ctx.strokeStyle = "#6f7891";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-6, -1.6);
    ctx.quadraticCurveTo(14, -2.6, 30, -1.2);
    ctx.lineTo(30, 1.2);
    ctx.quadraticCurveTo(14, 2.6, -6, 1.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-15, 0, 10, 6.4, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-16.5, -1.5, 5, 2.4, -0.2, 0, TAU);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fill();
  });
  lay(0.95, () => {
    // Honey pooled on the saucer, then the dipper: a ridged wooden head on a turned handle, a drip hanging from it.
    ctx.beginPath();
    ctx.ellipse(-12, 4, 13, 6.5, 0.1, 0, TAU);
    ctx.fillStyle = "rgba(226,160,48,0.75)";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-15, 2.6, 5, 1.8, 0.1, 0, TAU);
    ctx.fillStyle = "rgba(255,236,170,0.8)";
    ctx.fill();
    ctx.fillStyle = "#c9945a";
    ctx.strokeStyle = "#6e4a26";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-2, -1.8, 34, 3.6, 1.8);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-12, 0, 9, 6, 0, 0, TAU);
    ctx.fillStyle = "#d7a465";
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    for (const x of [-17, -13.5, -10, -6.5]) {
      ctx.moveTo(x, -5.2);
      ctx.lineTo(x, 5.2);
    }
    ctx.strokeStyle = "#8a5e30";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-14, 5);
    ctx.quadraticCurveTo(-13, 9, -12, 10.5);
    ctx.quadraticCurveTo(-10.5, 8, -10, 5);
    ctx.closePath();
    ctx.fillStyle = "rgba(226,160,48,0.95)";
    ctx.fill();
  });
  for (const [angle, s] of [
    [2.95, 1],
    [3.32, 0.8],
  ] as const) {
    lay(angle, () => {
      ctx.scale(s, s);
      ctx.fillStyle = "#fffdf6";
      ctx.strokeStyle = "#a9a48a";
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 9; i++) {
        ctx.save();
        ctx.rotate((i / 9) * TAU);
        ctx.beginPath();
        ctx.ellipse(0, -7, 2.6, 5.2, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 3.6, 0, TAU);
      ctx.fillStyle = "#f2c84a";
      ctx.fill();
      ctx.strokeStyle = "#c99a26";
      ctx.stroke();
    });
  }

  // The handle, a loop of china on the right, and the cup's shadow on the saucer.
  const ha = 0.12;
  const hx = cx + Math.cos(ha) * (rim + R * 0.13);
  const hy = cy + Math.sin(ha) * (rim + R * 0.13);
  for (const [dx, dy, width, colour] of [
    [R * 0.03, R * 0.05, R * 0.075, "rgba(10,14,48,0.22)"],
    [0, 0, R * 0.075, "#4d5a82"],
    [0, 0, R * 0.05, "#f6eedb"],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(hx + dx, hy + dy, R * 0.17, R * 0.1, ha, 0, TAU);
    ctx.lineWidth = width;
    ctx.strokeStyle = colour;
    ctx.stroke();
  }
  const cs = ctx.createRadialGradient(cx + R * 0.03, cy + R * 0.05, rim * 0.97, cx + R * 0.03, cy + R * 0.05, rim * 1.12);
  cs.addColorStop(0, "rgba(30,26,60,0.32)");
  cs.addColorStop(1, "rgba(30,26,60,0)");
  ctx.fillStyle = cs;
  ctx.beginPath();
  ctx.arc(cx + R * 0.03, cy + R * 0.05, rim * 1.12, 0, TAU);
  ctx.arc(cx, cy, rim * 0.99, 0, TAU, true);
  ctx.fill();

  // The cup: its inner wall from the tea up to the rim, shaded toward the tea and away from the light at the upper
  // left, a periwinkle band painted inside, and the rim with a gold line.
  ctx.beginPath();
  ctx.arc(cx, cy, rim, 0, TAU);
  ctx.arc(cx, cy, R, 0, TAU, true);
  const wall = ctx.createRadialGradient(cx, cy, R, cx, cy, rim);
  wall.addColorStop(0, "#c9b994");
  wall.addColorStop(0.35, "#efe6d0");
  wall.addColorStop(1, "#fffaf0");
  ctx.fillStyle = wall;
  ctx.fill();
  const lit = ctx.createLinearGradient(cx - rim, cy - rim, cx + rim, cy + rim);
  lit.addColorStop(0, "rgba(40,36,80,0.22)");
  lit.addColorStop(0.5, "rgba(40,36,80,0)");
  lit.addColorStop(1, "rgba(255,255,255,0.18)");
  ctx.fillStyle = lit;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.075, 0, TAU);
  ctx.lineWidth = R * 0.014;
  ctx.strokeStyle = "rgba(142,159,216,0.8)";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, rim - line, 0, TAU);
  ctx.lineWidth = line;
  ctx.strokeStyle = "#d6b16a";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, rim, 0, TAU);
  ctx.lineWidth = line * 1.4;
  ctx.strokeStyle = "#4d5a82";
  ctx.stroke();
  ctx.restore();
  return saucer;
}

let steamAt = "";
/**
 * The steam rising from the cup is the page's (style.css), so it can drift up slowly without redrawing the map, and
 * hold still for reduced motion. This tells it where the cup's rim is, or that there is no cup to steam.
 */
function steam(f: SceneryFrame, on: boolean) {
  const box = f.ctx.canvas.parentElement;
  if (!box) return;
  const R = f.proj.scale();
  const [cx, cy] = f.proj.translate();
  // From the rim up into the room above the cup, never down over the tea.
  const top = cy - R * 1.12;
  const tall = Math.min(R * 0.75, top - 4);
  on &&= tall > 28;
  const at = on ? `${Math.round(cx)},${Math.round(top)},${Math.round(tall)}` : "";
  if (at === steamAt && box.hasAttribute("data-steam") === on) return;
  steamAt = at;
  if (!on) {
    box.removeAttribute("data-steam");
    return;
  }
  box.setAttribute("data-steam", "");
  box.style.setProperty("--steam-x", `${Math.round(cx)}px`);
  box.style.setProperty("--steam-y", `${Math.round(top)}px`);
  box.style.setProperty("--steam-h", `${Math.round(tall)}px`);
}

/** `min`: pictures narrower than this many pixels either side are left out, so none shrinks to the size of a marker. */
function drawSpots(f: SceneryFrame, list: readonly Spot[], size: number, min = 0) {
  const { ctx, proj, mode, center } = f;
  const [cx, cy] = proj.translate();
  // Half the width of a picture: the open water around its spot, so it grows with zoom and never reaches land.
  const perDegree = (proj.scale() * Math.PI) / 180;
  for (const c of list) {
    const s = Math.min(170, c.r * perDegree * size);
    if (s < min) continue;
    const im = picture(c.kind, f.redraw);
    if (!im) continue;
    let alpha = 1;
    let squash = 1;
    if (mode === "3d") {
      const d = geoDistance([c.lon, c.lat], center);
      if (d > HIDE) continue;
      if (d > FADE) alpha = (HIDE - d) / (HIDE - FADE);
      squash = Math.cos(d);
    }
    const p = proj([c.lon, c.lat]);
    if (!p) continue;
    const [x, y] = p;
    const hw = s;
    const hh = (s * im.naturalHeight) / im.naturalWidth;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (squash < 0.999) {
      const tilt = Math.atan2(y - cy, x - cx);
      ctx.rotate(tilt);
      ctx.scale(squash, 1);
      ctx.rotate(-tilt);
    }
    if (c.flip) ctx.scale(-1, 1);
    ctx.drawImage(im, -hw, -hh, hw * 2, hh * 2);
    ctx.restore();
  }
}

/**
 * Undersea Town's water lit from above: brighter toward the top of the picture, with a few soft shafts of light
 * slanting down. Fixed to the screen like the surface of the sea overhead.
 */
function sunlit(f: SceneryFrame) {
  const { ctx, w, h } = f;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgba(255,255,225,0.34)");
  g.addColorStop(0.5, "rgba(255,255,225,0.06)");
  g.addColorStop(1, "rgba(0,40,80,0.12)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  for (const [x, wd] of [
    [0.12, 0.07],
    [0.33, 0.04],
    [0.58, 0.09],
    [0.82, 0.05],
  ] as const) {
    const x0 = x * w, ww = wd * w;
    const shaft = ctx.createLinearGradient(0, 0, 0, h * 0.85);
    shaft.addColorStop(0, "rgba(255,255,230,0.16)");
    shaft.addColorStop(1, "rgba(255,255,230,0)");
    ctx.fillStyle = shaft;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0 + ww, 0);
    ctx.lineTo(x0 + ww * 2.6 + h * 0.18, h * 0.85);
    ctx.lineTo(x0 + ww * 0.6 + h * 0.18, h * 0.85);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

let denimPattern: { ctx: CanvasRenderingContext2D; p: CanvasPattern } | null = null;
/** Denim twill: fine diagonal ribs with a little slub, as in a pair of jeans. */
function denim(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (denimPattern?.ctx === ctx) return denimPattern.p;
  const c = document.createElement("canvas");
  c.width = c.height = 24;
  const g = c.getContext("2d")!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = -24; i < 48; i += 3) {
    g.strokeStyle = `rgba(255,255,255,${(0.07 + rnd() * 0.08).toFixed(3)})`;
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 24, 24);
    g.stroke();
    g.strokeStyle = "rgba(10,20,40,0.12)";
    g.beginPath();
    g.moveTo(i + 1.5, 0);
    g.lineTo(i + 25.5, 24);
    g.stroke();
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(255,255,255,${(rnd() * 0.12).toFixed(3)})`;
    g.fillRect(rnd() * 24, rnd() * 24, 1 + rnd() * 2, 1);
  }
  const p = ctx.createPattern(c, "repeat")!;
  denimPattern = { ctx, p };
  return p;
}

let seamLayer: HTMLCanvasElement | null = null;
/** Orange double stitching a few pixels out from every coast, like the seams on a pair of jeans. */
function seam(f: SceneryFrame) {
  const { ctx, land, w, h } = f;
  if (!land) return;
  const dpr = ctx.getTransform().a;
  seamLayer ??= document.createElement("canvas");
  const c = seamLayer;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const g = c.getContext("2d")!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, c.width, c.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.lineJoin = "round";
  g.strokeStyle = "rgba(232,150,58,0.95)";
  // Each stitch line is a dashed band cut down to its outer edge; the half that falls on land is cut away last.
  for (const width of [15, 9]) {
    g.globalCompositeOperation = "source-over";
    g.setLineDash([4, 3]);
    g.lineWidth = width;
    g.stroke(land);
    g.globalCompositeOperation = "destination-out";
    g.setLineDash([]);
    g.lineWidth = width - 3;
    g.stroke(land);
  }
  g.fill(land);
  g.globalCompositeOperation = "source-over";
  ctx.save();
  f.outline();
  ctx.clip();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(c, 0, 0);
  ctx.restore();
}

/** A twisted rope laid around the sheet or the globe. */
function ropeFrame(f: SceneryFrame) {
  const { ctx } = f;
  ctx.save();
  ctx.lineJoin = "round";
  f.outline();
  ctx.lineWidth = 9;
  ctx.strokeStyle = "#5a3a1c";
  ctx.stroke();
  ctx.lineWidth = 6.5;
  ctx.strokeStyle = "#d6b27a";
  ctx.stroke();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = "#8a5e2c";
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/** Small four-point stars over the night sea, on Space's fixed star spots. */
function stars(f: SceneryFrame) {
  const { ctx, proj, mode, center } = f;
  ctx.save();
  ctx.fillStyle = "#fff6c8";
  const s = Math.min(6, Math.max(2.5, proj.scale() * 0.012));
  for (const [lon, lat, size] of STARS) {
    if (mode === "3d" && geoDistance([lon, lat], center) > HIDE) continue;
    const p = proj([lon, lat]);
    if (!p) continue;
    const r = s * (0.8 + size * 0.35);
    ctx.globalAlpha = 0.55 + size * 0.15;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1] - r);
    ctx.quadraticCurveTo(p[0], p[1], p[0] + r, p[1]);
    ctx.quadraticCurveTo(p[0], p[1], p[0], p[1] + r);
    ctx.quadraticCurveTo(p[0], p[1], p[0] - r, p[1]);
    ctx.quadraticCurveTo(p[0], p[1], p[0], p[1] - r);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The moon with the sleeping bear: on the globe it hangs outside the sphere at the upper right, and on the flat map
 * (or a globe zoomed in too far for it) it sits in the night over open ocean (TEA).
 */
function moon(f: SceneryFrame, saucer = 0) {
  const { ctx, proj, mode, w, h } = f;
  if (mode === "2d") {
    drawSpots(f, TEA, 1.1);
    return;
  }
  const im = picture("bear", f.redraw);
  if (!im) return;
  const R = proj.scale();
  const [cx, cy] = proj.translate();
  // Clear of the globe, or of the saucer round it when the cup shows.
  const clear = Math.max(R, saucer);
  // Upper right beside the globe, below the window's arch; when the globe fills that corner, the lower left. The moon
  // shrinks to the room there; when neither corner has enough, the bears sleep on the globe's own sea instead, at the
  // flat map's open-water spots, so zoomed in the bear is still there.
  const spots = [
    (s: number) => [Math.min(cx + R * 0.92, w - s * 0.5), Math.max(cy - R * 0.78, s * 0.36 + h * 0.08)],
    (s: number) => [w - s * 0.5 - 12, s * 0.375 + h * 0.17],
    (s: number) => [s * 0.5 + 10, h - s * 0.36 - 6],
  ];
  for (const at of spots) {
    for (let s = Math.min(230, Math.max(130, R * 0.62)); s >= 120; s -= 8) {
      const [x, y] = at(s) as [number, number];
      if (Math.hypot(x - cx, y - cy) < clear + s * 0.3) continue;
      ctx.drawImage(im, x - s / 2, y - (s * 0.75) / 2, s, s * 0.75);
      return;
    }
  }
  drawSpots(f, TEA, 1.1);
}

/**
 * A square picture in the margin beside the globe, placed by its corner: a negative x or y counts from the right or
 * bottom edge. It is left out when any part of it comes within `clear` pixels of the sphere.
 */
function aside(f: SceneryFrame, kind: string, size: number, x0: number, y0: number, flip: boolean, clear: number) {
  const { ctx, proj, w, h } = f;
  const im = picture(kind, f.redraw);
  if (!im) return;
  const R = proj.scale();
  const [cx, cy] = proj.translate();
  const s = Math.min(size, w * 0.3, h * 0.5);
  x0 = x0 < 0 ? w + x0 - s : x0;
  y0 = y0 < 0 ? h + y0 - s : y0;
  // The nearest point of the picture's box to the globe's centre must lie outside the globe.
  const nx = Math.min(Math.max(cx, x0), x0 + s);
  const ny = Math.min(Math.max(cy, y0), y0 + s);
  if (Math.hypot(nx - cx, ny - cy) < R + clear) return;
  ctx.save();
  ctx.translate(x0 + s / 2, y0 + s / 2);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(im, -s / 2, -s / 2, s, s);
  ctx.restore();
}

/**
 * Tarot: on the globe, a wheel round the sphere like the Wheel of Fortune's, two gold rings with ticks and small
 * four-point sparkles between them, and a sun and a crescent moon in the margins. Nothing is drawn on the sphere, so
 * the sparkles can't be taken for the star-shaped markers.
 */
function wheel(f: SceneryFrame) {
  const { ctx, proj, mode } = f;
  if (mode !== "3d") return;
  const R = proj.scale();
  const [cx, cy] = proj.translate();
  const r1 = R + 9;
  const r2 = R + 25;
  ctx.save();
  ctx.strokeStyle = "rgba(227,189,98,0.85)";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(cx, cy, r1, 0, Math.PI * 2);
  ctx.moveTo(cx + r2, cy);
  ctx.arc(cx, cy, r2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    const rb = i % 8 === 0 ? r2 : r1 + 4;
    ctx.moveTo(cx + c * r1, cy + s * r1);
    ctx.lineTo(cx + c * rb, cy + s * rb);
  }
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // Sparkles in the twelve spaces between the long ticks, stroked so none reads as a filled mark.
  ctx.beginPath();
  const rm = (r1 + r2) / 2 + 2;
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) / 12) * Math.PI * 2;
    const x = cx + Math.cos(a) * rm;
    const y = cy + Math.sin(a) * rm;
    ctx.moveTo(x, y - 4.5);
    ctx.quadraticCurveTo(x, y, x + 4.5, y);
    ctx.quadraticCurveTo(x, y, x, y + 4.5);
    ctx.quadraticCurveTo(x, y, x - 4.5, y);
    ctx.quadraticCurveTo(x, y, x, y - 4.5);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#f5e6c0";
  ctx.stroke();
  ctx.restore();
  const size = Math.min(170, Math.max(90, R * 0.42));
  aside(f, "moon", size, -8, 8, false, 30);
  aside(f, "sun", size, 8, -8, false, 30);
}
