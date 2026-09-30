import { geoDistance, type GeoProjection } from "d3-geo";
import type { Theme, ViewMode } from "../themes.ts";
import { STARS } from "./decor.ts";

/**
 * Scenery that tells four designs apart at a glance (decision 69): lily pads, frogs and dragonflies on the Frog
 * Pond, a moon with a sleeping bear on Bedtime Tea, the colossus, bridge, colonnade and crag of Thomas Cole's The
 * Course of Empire: Destruction on Course of Empire (id arcadia), and trick-rope loops, a rope frame and a denim sea
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
 * The Course of Empire: Destruction's landmarks standing in open water like its harbour: the headless colossus, the
 * broken bridge, the burning colonnade, the lone crag with its boulder, burning galleys and drifting smoke.
 */
export const EMPIRE: readonly Spot[] = [
  { kind: "colossus", lon: 70, lat: -10, r: 10 },
  { kind: "colossus", lon: -130, lat: -30, r: 14, flip: true },
  { kind: "bridge", lon: -38, lat: 26, r: 11 },
  { kind: "colonnade", lon: -14, lat: -54, r: 14, flip: true },
  { kind: "colonnade", lon: 162, lat: 42, r: 8 },
  { kind: "crag", lon: 138, lat: -54, r: 9 },
  { kind: "crag", lon: -130, lat: 26, r: 9, flip: true },
  { kind: "galley", lon: -178, lat: -1, r: 8 },
  { kind: "galley", lon: 90, lat: -10, r: 9, flip: true },
  { kind: "galley", lon: 46, lat: -34, r: 7 },
  { kind: "galley", lon: -94, lat: -6, r: 9 },
  { kind: "smoke", lon: -142, lat: 10, r: 14 },
  { kind: "smoke", lon: -22, lat: -30, r: 14, flip: true },
];

/** On the flat map the moon with the sleeping bear hangs in the night over the open Pacific, Atlantic and Indian Ocean. */
export const TEA: readonly Spot[] = [
  { kind: "bear", lon: -142, lat: 10, r: 14 },
  { kind: "bear", lon: -22, lat: -30, r: 14, flip: true },
  { kind: "bear", lon: 90, lat: -10, r: 9 },
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
 * Undersea Town: little houses on sandy mounds in open sea and flower-shaped clouds drifting in the water above,
 * all drawn for this site. Bubbles rise outside the map, in style.css.
 */
export const REEF: readonly Spot[] = [
  { kind: "fruithouse", lon: -142, lat: 10, r: 14 },
  { kind: "domehouse", lon: -22, lat: -30, r: 14 },
  { kind: "tikihouse", lon: 70, lat: -10, r: 10 },
  { kind: "tikihouse", lon: 154, lat: 30, r: 9, flip: true },
  { kind: "domehouse", lon: -158, lat: 46, r: 7, flip: true },
  { kind: "bloomblue", lon: -38, lat: 26, r: 11 },
  { kind: "bloompink", lon: -126, lat: -26, r: 14 },
  { kind: "bloomgreen", lon: 130, lat: -42, r: 7 },
  { kind: "bloomlilac", lon: -94, lat: -6, r: 9 },
  { kind: "bloomblue", lon: 6, lat: -58, r: 9, flip: true },
  { kind: "bloompink", lon: -166, lat: -34, r: 9, flip: true },
  { kind: "bloomgreen", lon: 46, lat: -34, r: 7 },
  { kind: "bloomlilac", lon: -94, lat: -58, r: 9, flip: true },
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

// Undersea Town. A flower-shaped cloud: rounded petals around a middle in three layers, darkest outside.
const BLOOM = (x: number, y: number, r: number, petals: number, rot: number, [edge, mid, core]: readonly [string, string, string]) => {
  const layer = (rr: number, fill: string, dx: number, dy: number) => {
    const d = rr * 0.56;
    const pr = rr * 0.46;
    const circles = Array.from({ length: petals }, (_, i) => {
      const a = ((rot + (i * 360) / petals) * Math.PI) / 180;
      return `<circle cx="${(dx + Math.cos(a) * d).toFixed(1)}" cy="${(dy + Math.sin(a) * d).toFixed(1)}" r="${pr.toFixed(1)}"/>`;
    }).join("");
    return `<g fill="${fill}">${circles}<circle cx="${dx}" cy="${dy}" r="${(rr * 0.6).toFixed(1)}"/></g>`;
  };
  return `<g transform="translate(${x} ${y})" opacity=".82">${layer(r + 3, edge, 0, 0)}${layer(r, mid, 0, 0)}${layer(r * 0.52, core, -r * 0.12, -r * 0.14)}</g>`;
};
const BLOOMS: Record<string, readonly [string, string, string]> = {
  blue: ["#62b4f0", "#a3d9ff", "#e2f4ff"],
  pink: ["#f27fb0", "#ffb9d6", "#ffe9f2"],
  green: ["#6fcf7e", "#aeebb4", "#e6fbe7"],
  lilac: ["#a784e6", "#d3bdfb", "#f3eaff"],
};

/** A thin trail of bubbles rising from a point: rings with a glint, larger as they rise. */
const BUBBLES = (x: number, y: number) =>
  `<g fill="rgba(230,252,255,.25)" stroke="#e9fdff" stroke-width="1.6">
    <circle cx="${x}" cy="${y}" r="2.6"/><circle cx="${x + 5}" cy="${y - 10}" r="3.6"/><circle cx="${x - 2}" cy="${y - 23}" r="4.8"/><circle cx="${x + 6}" cy="${y - 38}" r="6"/>
  </g>
  <path d="M${x - 4.4} ${y - 24}a3 3 0 0 1 2.4-2.6M${x + 2.4} ${y - 40}a4 4 0 0 1 3-3" stroke="#ffffff" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;

/** The sandy mound a house stands on, with a tuft of coral and a frond of weed. */
const MOUND = `<path d="M-84 58C-66 38-34 34 0 34S66 38 84 58Z" fill="#f1d596" stroke="#b58646" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M-50 50q4-2 8 0M30 48q5-2 9 0M-12 54q4-2 7 0" stroke="#c89c5c" stroke-width="2" fill="none" stroke-linecap="round"/>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M-66 48v-14m0 6l-7-8m7 3l6-9m-6 0v-6" stroke="#b4552c" stroke-width="5"/>
    <path d="M-66 48v-14m0 6l-7-8m7 3l6-9m-6 0v-6" stroke="#ff9a66" stroke-width="3"/>
    <path d="M62 48c-6-8 6-14 0-22s6-12 2-20" stroke="#1e7a3c" stroke-width="5"/>
    <path d="M62 48c-6-8 6-14 0-22s6-12 2-20" stroke="#4cc36a" stroke-width="3"/>
  </g>`;

/** A house in the shape of a fruit: a rounded body with a crossed rind, a crown of long leaves, a wooden door. */
const FRUIT_HOUSE = `${MOUND}
  <defs><clipPath id="b"><path d="M0-34C24-34 36-12 36 10C36 32 22 46 0 46C-22 46-36 32-36 10C-36-12-24-34 0-34Z"/></clipPath></defs>
  <g stroke="#1f6a2a" stroke-width="2.4" stroke-linejoin="round" fill="#3fae4e">
    <path d="M-2-30C-14-44-28-50-40-50C-30-42-20-34-12-26Z"/>
    <path d="M2-30C14-44 28-50 40-50C30-42 20-34 12-26Z"/>
    <path d="M-4-30C-12-50-10-62-4-70C-2-58 0-44 2-30Z" fill="#58c265"/>
    <path d="M4-30C12-50 10-62 4-70C2-58 0-44-2-30Z" fill="#58c265"/>
  </g>
  <path d="M0-34C24-34 36-12 36 10C36 32 22 46 0 46C-22 46-36 32-36 10C-36-12-24-34 0-34Z" fill="#f7a92a"/>
  <g clip-path="url(#b)" stroke="#c9741a" stroke-width="2.2" fill="none">
    <path d="M-60-40L40 60M-44-40L56 60M-28-40L72 60M-12-40L88 60M-76-40L24 60M-92-40L8 60M-108-40L-8 60"/>
    <path d="M60-40L-40 60M44-40L-56 60M28-40L-72 60M12-40L-88 60M76-40L-24 60M92-40L-8 60M108-40L8 60"/>
  </g>
  <path d="M-20-24C-26-12-28 4-24 18" stroke="#ffd36e" stroke-width="4" fill="none" stroke-linecap="round" opacity=".7"/>
  <path d="M0-34C24-34 36-12 36 10C36 32 22 46 0 46C-22 46-36 32-36 10C-36-12-24-34 0-34Z" fill="none" stroke="#8a4b10" stroke-width="3"/>
  <path d="M-11 46V31A11 11 0 0 1 11 31V46Z" fill="#b0703a" stroke="#5a3a14" stroke-width="2.6" stroke-linejoin="round"/>
  <path d="M-4 24V46M4 24V46" stroke="#7a4a20" stroke-width="1.6"/>
  <path d="M6 37h1" stroke="#ffe28a" stroke-width="3" stroke-linecap="round"/>
  <path d="M-25 4V-6a7 7 0 0 1 14 0V4Z" fill="#bfe9f5" stroke="#5a3a14" stroke-width="2.6" stroke-linejoin="round"/>
  <path d="M-18-12V4M-25-3H-11" stroke="#5a3a14" stroke-width="1.6"/>
  <path d="M-27 5h18" stroke="#4cc36a" stroke-width="4" stroke-linecap="round"/>
  <path d="M12 22V14a6 6 0 0 1 12 0V22Z" fill="#bfe9f5" stroke="#5a3a14" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M18 8V22" stroke="#5a3a14" stroke-width="1.4"/>
  ${BUBBLES(24, -52)}`;

/** A dome of rock with a rounded door and a crooked pipe on top. */
const DOME_HOUSE = `${MOUND}
  <defs><linearGradient id="d" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#c2b2a6"/><stop offset=".6" stop-color="#9c8b80"/><stop offset="1" stop-color="#7a6a60"/></linearGradient></defs>
  <path d="M-46 44C-48 8-28-20 0-20S48 8 46 44Z" fill="url(#d)" stroke="#54463f" stroke-width="3" stroke-linejoin="round"/>
  <g fill="#8a796f"><path d="M-30 4l8-4 6 4-2 7-9 1Z"/><path d="M14-8l9 1 3 7-6 4-7-4Z"/><path d="M22 22l8-2 4 6-5 5-7-3Z"/><path d="M-36 28l6-3 5 5-4 5-6-2Z"/></g>
  <path d="M-30-2C-24-12-14-16-6-16" stroke="#e0d3c8" stroke-width="3.5" fill="none" stroke-linecap="round" opacity=".7"/>
  <path d="M-12 44V32C-12 22 12 22 12 32V44Z" fill="#6a5a52" stroke="#3e322c" stroke-width="2.6" stroke-linejoin="round"/>
  <path d="M6 36h-2" stroke="#e8c35a" stroke-width="3" stroke-linecap="round"/>
  <path d="M10-18V-34h8" stroke="#54463f" stroke-width="6" fill="none" stroke-linejoin="round"/>
  <path d="M10-18V-34h8" stroke="#a3938a" stroke-width="3" fill="none" stroke-linejoin="round"/>
  ${BUBBLES(22, -40)}`;

/** A tall carved stone head standing on the sand, with lit square windows for eyes and a door for a mouth. */
const TIKI_HOUSE = `${MOUND}
  <path d="M-26 46V-18C-26-40-14-52 0-52S26-40 26-18V46Z" fill="#8ea2a5" stroke="#3f5256" stroke-width="3" stroke-linejoin="round"/>
  <path d="M-26-14C-26 20-22 36-18 46M18-44C22-36 22-26 20-18" stroke="#b5c6c8" stroke-width="3.5" fill="none" stroke-linecap="round" opacity=".7"/>
  <path d="M-30-30h8v26h-8ZM22-30h8v26h-8Z" fill="#7a8f93" stroke="#3f5256" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M-24-22H24" stroke="#3f5256" stroke-width="5" stroke-linecap="round"/>
  <path d="M-19-17h12v9h-12ZM7-17h12v9H7Z" fill="#ffe28a" stroke="#3f5256" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M-13-17v9M13-17v9" stroke="#3f5256" stroke-width="1.4"/>
  <path d="M0-20L-7 10C-4 13 4 13 7 10Z" fill="#7a8f93" stroke="#3f5256" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M-12 46V24H12V46Z" fill="#4a5c60" stroke="#2f3e41" stroke-width="2.6" stroke-linejoin="round"/>
  <path d="M-16 20H16" stroke="#3f5256" stroke-width="3" stroke-linecap="round"/>
  <g fill="#3fae4e" stroke="#1f6a2a" stroke-width="2" stroke-linejoin="round">
    <path d="M-2-50C-10-60-22-62-30-60C-22-56-12-52-6-48Z"/><path d="M2-50C10-62 22-66 30-64C22-58 12-52 6-48Z"/><path d="M0-50C-2-62 2-70 8-76C8-66 6-58 4-50Z"/>
  </g>
  <path d="M-20 30q5-4 10 0M8 36q4-3 8 0" stroke="#5f9c5a" stroke-width="3" fill="none" stroke-linecap="round"/>
  ${BUBBLES(-16, -60)}`;
/**
 * Course of Empire's engraving: diagonal hatching and cross-hatching in black for the shadow sides, and broken
 * horizontal strokes for the water under each piece. Greys only.
 */
const ENGRAVE = `<defs>
  <pattern id="h" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><path d="M0 0V3" stroke="#161616" stroke-width=".85"/></pattern>
  <pattern id="x" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><path d="M0 0V3M0 0H3" stroke="#161616" stroke-width=".75"/></pattern>
</defs>`;
const WAKE = `<path d="M-56 55H56M-40 60H40M-24 65H24" stroke="#ececec" stroke-width="1.1" stroke-dasharray="7 3" opacity=".6"/>`;

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

  // Course of Empire: pictures 160 by 160 after Cole's Destruction, standing on a waterline at y = 50, engraved in
  // greys and lit from the right. Fire is left white, as an engraver leaves it.
  colossus: svg(
    "-80 -80 160 160",
    `${ENGRAVE}
    <path d="M-46 50l4-7h8l3 7ZM33 50l3-6 7 1 2 5Z" fill="#9a9a9a" stroke="#161616" stroke-width="1.1" stroke-linejoin="round"/>
    <path d="M-30 50H30V45H26V21H30V15H-30V21H-26V45H-30Z" fill="#cdcdcd" stroke="#161616" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M-26 21H-8V45H-26ZM-30 45H-8V50H-30ZM-30 15H-8V21H-30Z" fill="url(#h)"/>
    <path d="M-26 29H26M-26 37H26M-6 21V29M10 29V37M-14 37V45M16 37V45" stroke="#161616" stroke-width=".7" opacity=".7"/>
    <g stroke="#161616" stroke-width="1.2" stroke-linejoin="round">
      <path d="M3-17L10 0L14 15H21L17-1L11-19Z" fill="#bdbdbd"/>
      <path d="M-4-19L-15 5L-18 15H-9L-7 6L1-12Z" fill="#dcdcdc"/>
      <path d="M-10-27H11L15-12H-13Z" fill="#cfcfcf"/>
      <path d="M-12-52C-13-44-11-34-10-27H11C12-34 14-44 13-52C7-55-6-55-12-52Z" fill="#e0e0e0"/>
      <path d="M12-51C18-49 21-41 23-33L20-30L21-34L18-31C16-38 14-43 11-45Z" fill="#d6d6d6"/>
      <path d="M-4-54L-3-59L-1-56.5L1-60L2.5-56.5L4-54Z" fill="#bdbdbd"/>
    </g>
    <path d="M3-17L10 0L14 15H21L17-1L11-19Z" fill="url(#h)"/>
    <path d="M-15 5L-18 15H-9L-7 6Z" fill="url(#h)"/>
    <path d="M-8-25V-12M-3-26V-12M2-26V-12M7-25V-12" stroke="#161616" stroke-width=".6"/>
    <path d="M-12-52C-13-44-11-34-10-27H-2V-54C-6-54-10-53-12-52Z" fill="url(#h)"/>
    <path d="M1-50V-31M-7-41C-3-39 4-39 8-41" stroke="#161616" stroke-width=".6" fill="none"/>
    <ellipse cx="-17" cy="-36" rx="10" ry="15" fill="#d2d2d2" stroke="#161616" stroke-width="1.3"/>
    <path d="M-17-51A10 15 0 0 0-17-21A5 15 0 0 1-17-51Z" fill="url(#x)"/>
    <ellipse cx="-17" cy="-36" rx="6.5" ry="10.5" fill="none" stroke="#161616" stroke-width=".7"/>
    ${WAKE}`,
  ),
  crag: svg(
    "-80 -80 160 160",
    `${ENGRAVE}
    <path d="M-62-6C-56-16-42-16-36-10C-28-18-14-14-14-6C-4-10 6-2 0 4H-58C-66 2-68-2-62-6Z" fill="#2e2e2e" opacity=".5"/>
    <path d="M-40 52L-32 24L-25-2L-17-26L-9-40L1-44L9-34L14-10L21 14L30 34L42 52Z" fill="#a4a4a4" stroke="#161616" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M-40 52L-32 24L-25-2L-17-26L-9-40L1-44L-1-12L-5 18L-8 52Z" fill="url(#x)"/>
    <path d="M1-44L9-34L14-10L21 14L30 34L42 52H24L14 22L6-10Z" fill="#d8d8d8" opacity=".75"/>
    <path d="M-16-8l8 3M-4-26l7 5M6 6l10 3M-26 30l12 2M16 30l8 6" stroke="#161616" stroke-width="1"/>
    <path d="M-9-44C-11-52-5-60 2-59C9-58 12-51 9-45C5-42-4-41-9-44Z" fill="#c4c4c4" stroke="#161616" stroke-width="1.3"/>
    <path d="M-9-44C-11-52-5-60 2-59C-1-54-2-48 0-42C-4-42-7-43-9-44Z" fill="url(#h)"/>
    <path d="M14-30C22-40 38-38 42-28C52-32 60-24 56-14H18C10-16 8-24 14-30Z" fill="#2a2a2a" opacity=".6"/>
    <path d="M22-34C28-36 34-34 38-30" stroke="#9a9a9a" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    ${WAKE}`,
  ),
  colonnade: svg(
    "-80 -80 160 160",
    `${ENGRAVE}<g transform="translate(0 4) scale(.92)">
    <path d="M-50-44C-58-56-44-70-32-64C-28-76-8-78-2-68C6-76 24-72 24-60C34-62 42-52 36-44C28-38 14-42 8-40C0-34-14-38-20-42C-30-36-44-36-50-44Z" fill="#262626" opacity=".85"/>
    <path d="M-32-64C-26-66-20-64-16-60M-2-68C4-70 10-68 14-64M24-60C28-60 32-58 34-54" stroke="#8c8c8c" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <path d="M-44-14C-48-28-38-34-40-46C-32-38-26-42-28-54C-18-42-14-34-18-24C-12-30-8-34-10-44C0-32 2-22-4-14Z" fill="#f4f4f4" stroke="#8a8a8a" stroke-width=".8"/>
    <path d="M14 36C8 22 18 14 16 0C24 10 26 2 26-10C34 4 40 12 36 22C42 18 44 12 44 6C50 18 50 28 44 36Z" fill="#f0f0f0" stroke="#8a8a8a" stroke-width=".8"/>
    <path d="M-56 50V43H52V50ZM-52 43V38H48V43Z" fill="#b8b8b8" stroke="#161616" stroke-width="1.1"/>
    <path d="M-56 43H-20V50H-56Z" fill="url(#h)"/>
    <g fill="#d8d8d8" stroke="#161616" stroke-width="1.1" stroke-linejoin="round">
      <path d="M-47 38V-8H-39V38Z"/><path d="M-29 38V-8H-21V38Z"/><path d="M-11 38V-8H-3V38Z"/><path d="M7 38V-8H15V38Z"/>
      <path d="M25 38V6L28 3L30 7L33 4V38Z"/><path d="M41 38V26L44 22L47 27V38Z"/>
    </g>
    <path d="M-47 38V-8H-44V38ZM-29 38V-8H-26V38ZM-11 38V-8H-8V38ZM7 38V-8H10V38ZM25 38V6L27 4V38ZM41 38V26L43 24V38Z" fill="url(#h)"/>
    <path d="M-51-8H18L20-12L17-16H-51Z" fill="#cfcfcf" stroke="#161616" stroke-width="1.1" stroke-linejoin="round"/>
    <path d="M-51-16L-24-30L-2-19L-4-16Z" fill="#c6c6c6" stroke="#161616" stroke-width="1.1" stroke-linejoin="round"/>
    <path d="M-51-12H18" stroke="#161616" stroke-width=".6"/>
    <path d="M54 50l2-5h9l1 5Z" fill="#a0a0a0" stroke="#161616" stroke-width="1"/>
    </g>${WAKE}`,
  ),
  bridge: svg(
    "-80 -80 160 160",
    `${ENGRAVE}<g transform="scale(.88)">
    <path d="M-8 2C-16-8-6-16-12-28C-2-22 2-32 0-44C10-34 16-38 14-52C24-40 22-28 16-22C22-20 24-10 14-2Z" fill="#262626" opacity=".72"/>
    <g fill="#cdcdcd" stroke="#161616" stroke-width="1.2" stroke-linejoin="round">
      <path d="M-72 50V4H-16L-12 10L-17 16L-13 24L-14 50H-22V32A8 12 0 0 0-38 32V50H-46V32A9 12 0 0 0-64 32V50Z"/>
      <path d="M14 50V30L10 22L15 16L11 8L16 4H72V50H64V32A9 12 0 0 0 46 32V50H38V32A8 12 0 0 0 22 32V50Z"/>
    </g>
    <path d="M-72 13H-15L-13 24L-14 50H-22V32A8 12 0 0 0-38 32V50H-46V32A9 12 0 0 0-64 32V50H-72ZM12 13H72V50H64V32A9 12 0 0 0 46 32V50H38V32A8 12 0 0 0 22 32V50H14V30L10 22Z" fill="url(#h)" opacity=".85"/>
    <path d="M-72 4V-2H-18L-16 4ZM16 4L19-2H72V4Z" fill="#dcdcdc" stroke="#161616" stroke-width="1"/>
    <path d="M-72 13H-15M13 13H72M-60 4V13M-44 4V13M-28 4V13M28 4V13M44 4V13M60 4V13" stroke="#161616" stroke-width=".6" opacity=".8"/>
    <path d="M-8 50l3-8h8l3 8ZM3 47l6-5 5 5-3 3Z" fill="#a4a4a4" stroke="#161616" stroke-width="1"/>
    <path d="M-62 45H-48M-36 45H-24M24 45H36M48 45H62" stroke="#ececec" stroke-width=".8" opacity=".55"/>
    </g>${WAKE}`,
  ),
  galley: svg(
    "-80 -80 160 160",
    `${ENGRAVE}
    <path d="M30-4C24-16 36-24 32-38C42-30 48-42 46-56C56-44 58-32 50-22C56-18 54-6 44-4Z" fill="#262626" opacity=".78"/>
    <path d="M0 26V-42" stroke="#161616" stroke-width="2"/>
    <path d="M-26-36H26" stroke="#161616" stroke-width="1.6"/>
    <path d="M0-42L-54 18M0-42L50 20" stroke="#161616" stroke-width=".6"/>
    <path d="M-24-35C-26-14-22 2-20 10L-6 6L-2 14L8 8L20 10C23-6 25-20 24-35Z" fill="#dedede" stroke="#161616" stroke-width="1.1" stroke-linejoin="round"/>
    <path d="M-24-35C-26-14-22 2-20 10L-10 7C-12-6-12-22-10-35Z" fill="url(#h)"/>
    <path d="M-64 16L-50 22H46L58 14L54 26C40 36-40 38-54 28Z" fill="#3c3c3c" stroke="#161616" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M-50 25H48" stroke="#bdbdbd" stroke-width="1"/>
    <path d="M-38 31l-7 16M-26 33l-6 16M-14 34l-5 16M-2 34l-4 16M10 34l-3 16M22 33l-2 16" stroke="#161616" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M30 22C26 12 34 6 32-4C40 4 42-2 42-12C48-2 52 8 46 20Z" fill="#f4f4f4" stroke="#8a8a8a" stroke-width=".8"/>
    ${WAKE}`,
  ),
  smoke: svg(
    "-80 -40 160 80",
    `<path d="M-70 24C-78 10-64-4-50 0C-50-18-28-26-16-14C-10-30 16-32 24-18C38-26 60-18 58-2C72 0 76 18 64 24Z" fill="#262626" opacity=".78"/>
    <path d="M-50 0C-44-8-34-10-26-6M-16-14C-10-20 0-22 8-18M24-18C32-20 42-18 48-12M58-2C62-2 66 2 66 6" stroke="#a0a0a0" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M-44 18C-40 8-28 6-22 12C-16 4-2 4 2 12C8 6 22 8 24 16" stroke="#5a5a5a" stroke-width="1.4" fill="none"/>`,
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

  // Undersea Town: houses 200 by 160 standing on a mound at y = 58, and clusters of flower clouds 200 by 140.
  fruithouse: svg("-100 -90 200 160", FRUIT_HOUSE),
  domehouse: svg("-100 -90 200 160", DOME_HOUSE),
  tikihouse: svg("-100 -90 200 160", TIKI_HOUSE),
  ...Object.fromEntries(
    Object.entries(BLOOMS).map(([name, c]) => [
      `bloom${name}`,
      svg("-100 -70 200 140", `${BLOOM(-26, -8, 40, 6, 10, c)}${BLOOM(42, 26, 24, 5, -20, c)}${BLOOM(52, -40, 14, 5, 30, c)}`),
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
  } else if (t.scenery === "reef") sunlit(f);
}

/** Over the land, under the dots. */
export function drawScenery(f: SceneryFrame) {
  const t = f.theme;
  if (t.scenery === "pond") drawSpots(f, POND, 0.95);
  else if (t.scenery === "empire") {
    drawSpots(f, EMPIRE, 0.95);
    beside(f);
  } else if (t.scenery === "arcana") wheel(f);
  else if (t.scenery === "reef") drawSpots(f, REEF, 0.95, 16);
  else if (t.scenery === "rope") {
    seam(f);
    drawSpots(f, ROPE, 0.95);
    ropeFrame(f);
  } else if (t.scenery === "tea") {
    stars(f);
    moon(f);
  }
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
function moon(f: SceneryFrame) {
  const { ctx, proj, mode, w, h } = f;
  if (mode === "2d") {
    drawSpots(f, TEA, 1.1);
    return;
  }
  const im = picture("bear", f.redraw);
  if (!im) return;
  const R = proj.scale();
  const [cx, cy] = proj.translate();
  // Upper right beside the globe, below the window's arch; when the globe fills that corner, the lower left. The moon
  // shrinks to the room there; when neither corner has enough, the bears sleep on the globe's own sea instead, at the
  // flat map's open-water spots, so zoomed in the bear is still there.
  const spots = [
    (s: number) => [Math.min(cx + R * 0.92, w - s * 0.5), Math.max(cy - R * 0.78, s * 0.36 + h * 0.08)],
    (s: number) => [s * 0.5 + 10, h - s * 0.36 - 6],
  ];
  for (const at of spots) {
    for (let s = Math.min(230, Math.max(110, R * 0.55)); s >= 120; s -= 8) {
      const [x, y] = at(s) as [number, number];
      if (Math.hypot(x - cx, y - cy) < R + s * 0.3) continue;
      ctx.drawImage(im, x - s / 2, y - (s * 0.75) / 2, s, s * 0.75);
      return;
    }
  }
  drawSpots(f, TEA, 1.1);
}

/**
 * Course of Empire's globe stands in Destruction's harbour: the headless colossus in the foreground and the lone
 * crag in the distance, both outside the sphere. A picture is left out when
 * any part of it would reach the globe, so it never covers land or a place.
 */
function beside(f: SceneryFrame) {
  if (f.mode !== "3d") return;
  const R = f.proj.scale();
  const cy = f.proj.translate()[1];
  // The colossus stands at the lower left, where the map's own buttons leave room, and faces into the harbour.
  const big = Math.min(320, Math.max(140, R * 0.85));
  aside(f, "colossus", big, 2, -2, true, 4);
  aside(f, "crag", big * 0.7, -18, Math.max(4, cy - big * 0.62), true, 4);
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
