import { geoDistance, type GeoProjection } from "d3-geo";
import type { Theme, ViewMode } from "../themes.ts";
import { STARS } from "./decor.ts";

/**
 * Scenery that tells four designs apart at a glance (decision 69): lily pads, frogs and dragonflies on the Frog
 * Pond, a moon with a sleeping bear on Bedtime Tea, the crag, lone column and temple of Thomas Cole's The Course
 * of Empire on Arcadia, and trick-rope loops, a rope frame and a denim sea on Lasso. Every piece sits at a fixed
 * spot in open ocean far from land and from every outlet's city (test/scenery.test.ts), or outside the map
 * itself, and none carries text. They are drawn from small SVG pictures, made once and cached.
 */

export type SceneryKind = "pond" | "tea" | "empire" | "rope" | "reef";

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

/** The Course of Empire's landmarks and evening clouds, standing in open water like its bay. */
export const EMPIRE: readonly Spot[] = [
  { kind: "crag", lon: -130, lat: -30, r: 14 },
  { kind: "column", lon: 70, lat: -10, r: 10 },
  { kind: "temple", lon: -34, lat: 26, r: 9 },
  { kind: "arch", lon: 162, lat: 42, r: 8 },
  { kind: "temple", lon: -14, lat: -54, r: 14, flip: true },
  { kind: "column", lon: 138, lat: -54, r: 9 },
  { kind: "crag", lon: -130, lat: 26, r: 9, flip: true },
  { kind: "column", lon: -178, lat: -1, r: 8 },
  { kind: "cloud", lon: -142, lat: 10, r: 14 },
  { kind: "cloud", lon: -94, lat: -6, r: 9 },
  { kind: "cloud", lon: 90, lat: -10, r: 9 },
];

/** On the flat map the moon with the sleeping bear hangs in the night over the open Pacific. */
export const TEA: readonly Spot[] = [{ kind: "bear", lon: -142, lat: 10, r: 14 }];

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

const PAD = (x: number, y: number, r: number, rot: number, fill = "#5aa640") => {
  const a = (15 * Math.PI) / 180;
  const nx = Math.sin(a) * r;
  const ny = -Math.cos(a) * r;
  const vein = [0, 45, 90, 135, 180, 225, 270, 315]
    .map((d) => {
      const t = ((d + 22) * Math.PI) / 180;
      return `M0 0L${(Math.sin(t) * r * 0.9).toFixed(1)} ${(-Math.cos(t) * r * 0.9).toFixed(1)}`;
    })
    .join("");
  return `<g transform="translate(${x} ${y}) rotate(${rot})">
    <ellipse cx="3" cy="4" rx="${r}" ry="${r * 0.96}" fill="rgba(10,40,25,.35)"/>
    <path d="M0 0L${nx.toFixed(1)} ${ny.toFixed(1)}A${r} ${r} 0 1 1 ${(-nx).toFixed(1)} ${ny.toFixed(1)}Z" fill="${fill}" stroke="#2c6424" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="${vein}" stroke="#397c2c" stroke-width="1.5" opacity=".7"/>
    <ellipse cx="${-r * 0.3}" cy="${r * 0.3}" rx="${r * 0.45}" ry="${r * 0.25}" fill="#9bd872" opacity=".35"/>
  </g>`;
};

const RIPPLES = (x: number, y: number, r: number) =>
  `<g fill="none" stroke="#cdeedd" stroke-linecap="round">
    <ellipse cx="${x}" cy="${y}" rx="${r * 1.35}" ry="${r * 1.1}" stroke-width="1.6" opacity=".45" stroke-dasharray="${r * 0.9} ${r * 0.35}"/>
    <ellipse cx="${x}" cy="${y}" rx="${r * 1.7}" ry="${r * 1.4}" stroke-width="1.2" opacity=".25" stroke-dasharray="${r * 0.6} ${r * 0.6}"/>
  </g>`;

const FROG = `<g>
  <path d="M-13 6C-30 2-36 20-26 27C-20 31-14 25-11 18Z" fill="#4f9e2d" stroke="#1f4a17" stroke-width="2"/>
  <path d="M13 6C30 2 36 20 26 27C20 31 14 25 11 18Z" fill="#4f9e2d" stroke="#1f4a17" stroke-width="2"/>
  <path d="M-27 26l-7 4m7-4l-3 7m29-7" stroke="#1f4a17" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M27 26l7 4m-7-4l3 7" stroke="#1f4a17" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M-9-6C-19-4-22 3-19 8M9-6C19-4 22 3 19 8" stroke="#1f4a17" stroke-width="6" stroke-linecap="round" fill="none"/>
  <path d="M-9-6C-19-4-22 3-19 8M9-6C19-4 22 3 19 8" stroke="#66bb3a" stroke-width="3" stroke-linecap="round" fill="none"/>
  <ellipse cx="0" cy="6" rx="15" ry="18" fill="#6cc040" stroke="#1f4a17" stroke-width="2"/>
  <ellipse cx="-5" cy="10" rx="3.2" ry="2.4" fill="#3f8a25"/><ellipse cx="6" cy="14" rx="2.6" ry="2" fill="#3f8a25"/><ellipse cx="2" cy="3" rx="2.2" ry="1.8" fill="#3f8a25"/>
  <ellipse cx="0" cy="-11" rx="14" ry="10" fill="#6cc040" stroke="#1f4a17" stroke-width="2"/>
  <circle cx="-8" cy="-18" r="6.2" fill="#6cc040" stroke="#1f4a17" stroke-width="2"/>
  <circle cx="8" cy="-18" r="6.2" fill="#6cc040" stroke="#1f4a17" stroke-width="2"/>
  <circle cx="-8" cy="-19" r="3.8" fill="#fffbe0"/><circle cx="8" cy="-19" r="3.8" fill="#fffbe0"/>
  <ellipse cx="-8" cy="-19" rx="1.4" ry="2.6" fill="#141414"/><ellipse cx="8" cy="-19" rx="1.4" ry="2.6" fill="#141414"/>
  <path d="M-8-7Q0-3 8-7" stroke="#1f4a17" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <ellipse cx="-4" cy="-2" rx="6" ry="3" fill="#a6e07a" opacity=".45"/>
</g>`;

const LOTUS = (x: number, y: number, s: number) => {
  const outer = [0, 45, 90, 135, 180, 225, 270, 315]
    .map((d) => `<ellipse cx="0" cy="-10" rx="5.5" ry="11" transform="rotate(${d})" fill="#ffb0cf" stroke="#cf4f8a" stroke-width="1.2"/>`)
    .join("");
  const inner = [22, 82, 142, 202, 262, 322]
    .map((d) => `<ellipse cx="0" cy="-6" rx="4" ry="7.5" transform="rotate(${d})" fill="#ffd9e8" stroke="#e07aa8" stroke-width="1"/>`)
    .join("");
  return `<g transform="translate(${x} ${y}) scale(${s})">${outer}${inner}<circle r="3.6" fill="#ffd84a" stroke="#c9901a" stroke-width="1"/></g>`;
};

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

const svg = (vb: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="400" height="${Math.round((400 * Number(vb.split(" ")[3])) / Number(vb.split(" ")[2]))}">${body}</svg>`;

export const PICTURES: Record<string, string> = {
  // Pond: each picture is 200 by 140, centred.
  frog: svg("-100 -70 200 140", `${RIPPLES(0, 4, 40)}${PAD(0, 4, 40, 18)}<g transform="translate(-2 2) scale(1.15)">${FROG}</g>`),
  lotus: svg("-100 -70 200 140", `${RIPPLES(-10, 0, 36)}${PAD(34, 18, 22, -60, "#4c9637")}${PAD(-12, -2, 36, 200)}${LOTUS(-12, -4, 1.35)}`),
  pads: svg("-100 -70 200 140", `${RIPPLES(0, 0, 38)}${PAD(-30, -14, 26, 40)}${PAD(22, -18, 20, 160, "#4c9637")}${PAD(4, 20, 30, 280)}
    <g transform="translate(-34 -18)"><ellipse cx="0" cy="-2" rx="5" ry="9" fill="#ff9cc4" stroke="#cf4f8a" stroke-width="1.2"/><ellipse cx="0" cy="-4" rx="2.6" ry="6" fill="#ffd9e8"/></g>`),
  dragonfly: svg("-100 -70 200 140", `${RIPPLES(-24, 26, 18)}${PAD(-24, 26, 18, 120, "#4c9637")}<ellipse cx="14" cy="18" rx="26" ry="8" fill="rgba(10,40,25,.25)"/><g transform="translate(14 -10) scale(1.3)">${DRAGONFLY}</g>`),

  // Bedtime Tea: a bear in a nightcap asleep in a crescent moon, under a patchwork quilt. 240 by 180.
  bear: svg(
    "-120 -90 240 180",
    `<defs><radialGradient id="g"><stop offset="0" stop-color="#fff6c8" stop-opacity=".7"/><stop offset="1" stop-color="#fff6c8" stop-opacity="0"/></radialGradient></defs>
    <circle cx="0" cy="10" r="88" fill="url(#g)"/>
    <path d="M-78-4A78 78 0 0 0 78-4A80 54 0 0 1-78-4Z" fill="#fff0b3" stroke="#e6c46a" stroke-width="3" stroke-linejoin="round"/>
    <path d="M-60 26A70 60 0 0 0 40 50" stroke="#f2d27e" stroke-width="6" fill="none" stroke-linecap="round" opacity=".7"/>
    <ellipse cx="8" cy="8" rx="46" ry="20" fill="#9a6a44" stroke="#4a2e1a" stroke-width="3"/>
    <path d="M-30 4C-24-16 30-18 52-2C58 6 54 22 40 26L-22 26C-32 22-34 12-30 4Z" fill="#b9d3a8" stroke="#4a5e3e" stroke-width="3" stroke-linejoin="round"/>
    <path d="M-8-10L-6 26M16-12L18 26M38-6L38 24M-30 8L54 6" stroke="#6f8c5f" stroke-width="2" stroke-dasharray="4 3" fill="none"/>
    <path d="M-20-6l6 6m18-8l6 6m18-2l6 6" stroke="#f3e2b0" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="-42" cy="-10" r="22" fill="#a8744a" stroke="#4a2e1a" stroke-width="3"/>
    <circle cx="-26" cy="-28" r="8" fill="#a8744a" stroke="#4a2e1a" stroke-width="3"/>
    <ellipse cx="-56" cy="-2" rx="11" ry="8" fill="#e2c29a" stroke="#4a2e1a" stroke-width="2.5"/>
    <ellipse cx="-63" cy="-5" rx="4" ry="3" fill="#3a2414"/>
    <path d="M-48-14q5 4 10 0" stroke="#3a2414" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M-38-3q5 4 9 1" stroke="#c98a7a" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>
    <path d="M-62-22C-60-44-36-52-18-46C0-40 14-48 22-62C26-40 12-26-8-26C-22-26-30-18-38-16C-48-14-58-14-62-22Z" fill="#7d95d0" stroke="#34466e" stroke-width="3" stroke-linejoin="round"/>
    <path d="M-60-24C-48-30-30-30-20-26" stroke="#fdf8e8" stroke-width="7" stroke-linecap="round" fill="none"/>
    <path d="M-44-44l8 14M-26-46l4 16M-8-42l2 12M8-50l0 12" stroke="#b7c6ee" stroke-width="3" stroke-linecap="round"/>
    <circle cx="24" cy="-64" r="8" fill="#fdf8e8" stroke="#34466e" stroke-width="2.5"/>
    <path d="M30-30l4 0m-2-2l0 4M78-50l6 0m-3-3l0 6M-86-40l6 0m-3-3l0 6" stroke="#fff6c8" stroke-width="2" stroke-linecap="round"/>`,
  ),

  // Arcadia: pictures 160 by 160, standing on a waterline at y = 50, lit from the right like Cole's evening light.
  crag: svg(
    "-80 -80 160 160",
    `<defs><linearGradient id="r" x1="0" x2="1"><stop offset="0" stop-color="#231f18"/><stop offset=".62" stop-color="#4e4230"/><stop offset="1" stop-color="#d4a55a"/></linearGradient></defs>
    <ellipse cx="4" cy="52" rx="52" ry="7" fill="rgba(255,226,160,.3)"/>
    <path d="M-38 52L-30 20L-24-6L-16-30L-8-44L4-48L12-36L16-12L22 14L30 36L42 52Z" fill="url(#r)" stroke="#1a160f" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M-20-8l10 4M-4-28l12 6M8 6l12 4M-28 28l14 2" stroke="#1a160f" stroke-width="1.4" opacity=".6"/>
    <ellipse cx="4" cy="-58" rx="12" ry="10" fill="url(#r)" stroke="#1a160f" stroke-width="1.5"/>
    <path d="M-30 22c6-6 12-4 16 0M16 10c6-4 10-2 12 2M-14-22c4-4 8-4 10 0" stroke="#4d5c2a" stroke-width="5" stroke-linecap="round" fill="none"/>
    <path d="M-38 54h80" stroke="#f0cf8a" stroke-width="1.5" opacity=".7"/>
    <path d="M-30 58h56M-20 62h36" stroke="#e8c47a" stroke-width="1" opacity=".5"/>`,
  ),
  column: svg(
    "-80 -80 160 160",
    `<defs><linearGradient id="c" x1="0" x2="1"><stop offset="0" stop-color="#7a6a52"/><stop offset=".5" stop-color="#d9ccae"/><stop offset=".85" stop-color="#f6e7c4"/><stop offset="1" stop-color="#b8a27c"/></linearGradient></defs>
    <ellipse cx="0" cy="52" rx="30" ry="5" fill="rgba(255,226,160,.3)"/>
    <path d="M-12 50L-11-40L11-40L12 50Z" fill="url(#c)" stroke="#3a3122" stroke-width="1.5"/>
    <path d="M-6-38V48M0-38V48M6-38V48" stroke="#6e5f46" stroke-width="1" opacity=".55"/>
    <path d="M-18-40h36l-4-8h-28Z" fill="url(#c)" stroke="#3a3122" stroke-width="1.5"/>
    <path d="M-20-48c0-8 6-8 8-4c2-8 8-8 12-8s10 0 12 8c2-4 8-4 8 4Z" fill="url(#c)" stroke="#3a3122" stroke-width="1.5"/>
    <path d="M-16-52l6 4 4-8M16-52l-6 4-4-8" stroke="#6e5f46" stroke-width="1.2" fill="none"/>
    <path d="M-14 50h28" stroke="#3a3122" stroke-width="2"/>
    <path d="M-10 40c10-6-8-14 4-22s-6-16 6-24s-4-14 8-20" stroke="#44552a" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M-8 30l-5-3M4 18l6-2M-4 6l-6-2M8-8l6 0M-2-20l-5-4" stroke="#5f7438" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M-24 56h48M-14 60h28" stroke="#e8c47a" stroke-width="1" opacity=".5"/>`,
  ),
  temple: svg(
    "-80 -80 160 160",
    `<defs><linearGradient id="t" x1="0" x2="1"><stop offset="0" stop-color="#8a7a5e"/><stop offset=".7" stop-color="#eadcb8"/><stop offset="1" stop-color="#fff0c8"/></linearGradient>
    <linearGradient id="k" x1="0" x2="1"><stop offset="0" stop-color="#2a241a"/><stop offset="1" stop-color="#8a6a3a"/></linearGradient></defs>
    <ellipse cx="0" cy="52" rx="60" ry="7" fill="rgba(255,226,160,.3)"/>
    <path d="M-56 52C-50 30-40 20-30 14H34C44 22 52 34 58 52Z" fill="url(#k)" stroke="#1a160f" stroke-width="1.5"/>
    <path d="M-40 14H40V8H-40ZM-36 8H36V3H-36Z" fill="url(#t)" stroke="#3a3122" stroke-width="1.2"/>
    <g fill="url(#t)" stroke="#3a3122" stroke-width="1.2"><rect x="-32" y="-30" width="7" height="33"/><rect x="-15" y="-30" width="7" height="33"/><rect x="2" y="-30" width="7" height="33"/><rect x="19" y="-30" width="7" height="33"/></g>
    <path d="M-38-30H36V-37H-38Z" fill="url(#t)" stroke="#3a3122" stroke-width="1.2"/>
    <path d="M-40-37L-1-56L38-37Z" fill="url(#t)" stroke="#3a3122" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M-26-40L-1-51L24-40" stroke="#8a7a5e" stroke-width="1" fill="none"/>
    <path d="M-48 58h96M-30 62h60" stroke="#e8c47a" stroke-width="1" opacity=".5"/>`,
  ),
  arch: svg(
    "-80 -80 160 160",
    `<defs><linearGradient id="a" x1="0" x2="1"><stop offset="0" stop-color="#6a5a44"/><stop offset=".7" stop-color="#cdbb94"/><stop offset="1" stop-color="#f2dfb2"/></linearGradient></defs>
    <ellipse cx="0" cy="52" rx="62" ry="7" fill="rgba(255,226,160,.3)"/>
    <path d="M-56 52V-4H-40V52ZM24 52V-4H40V52Z" fill="url(#a)" stroke="#3a3122" stroke-width="1.5"/>
    <path d="M-58-4H-38C-38-24-20-34-4-34V-22C-16-22-26-14-26-4" fill="url(#a)" stroke="#3a3122" stroke-width="1.5"/>
    <path d="M22-4H42C42-20 34-30 22-32L18-22C22-18 24-10 24-4Z" fill="url(#a)" stroke="#3a3122" stroke-width="1.5"/>
    <path d="M-2-24l4-6 6 4M6-22l3-5" stroke="#3a3122" stroke-width="1.2" fill="none"/>
    <path d="M-52 10h8M-52 26h8M28 12h8M28 30h8" stroke="#6e5f46" stroke-width="1"/>
    <path d="M-60 58h120M-36 62h72" stroke="#e8c47a" stroke-width="1" opacity=".5"/>`,
  ),
  cloud: svg(
    "-80 -40 160 80",
    `<defs><radialGradient id="w" cx=".6" cy=".3"><stop offset="0" stop-color="#fff8e4"/><stop offset=".7" stop-color="#f3d9a8"/><stop offset="1" stop-color="#c9a878" stop-opacity=".6"/></radialGradient></defs>
    <path d="M-66 20C-76 6-60-10-44-6C-42-24-18-30-6-18C2-34 30-32 36-14C54-20 72-6 64 12C70 22 56 28 44 24H-54C-62 26-70 24-66 20Z" fill="url(#w)" opacity=".85"/>`,
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

/** Under the land, over the sea: Arcadia's evening light and Lasso's denim. Called inside the sphere's clip. */
export function drawSceneryUnder(f: SceneryFrame) {
  const { ctx, theme: t, mode, w, h } = f;
  if (t.scenery === "empire") {
    const R = f.proj.scale();
    const [cx, cy] = f.proj.translate();
    const sx = mode === "3d" ? cx + R * 0.45 : w * 0.72;
    const sy = mode === "3d" ? cy - R * 0.55 : Math.max(0, cy - R * 1.2);
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(w, h) * 0.9);
    g.addColorStop(0, "rgba(255,226,150,0.75)");
    g.addColorStop(0.35, "rgba(240,180,100,0.35)");
    g.addColorStop(1, "rgba(40,60,70,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else if (t.scenery === "rope") {
    ctx.fillStyle = denim(ctx);
    ctx.fillRect(0, 0, w, h);
  } else if (t.scenery === "reef") sunlit(f);
}

/** Over the land, under the dots. */
export function drawScenery(f: SceneryFrame) {
  const t = f.theme;
  if (t.scenery === "pond") drawSpots(f, POND, 0.95);
  else if (t.scenery === "empire") drawSpots(f, EMPIRE, 0.95);
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
 * it sits in the night over the open Pacific (TEA).
 */
function moon(f: SceneryFrame) {
  const { ctx, proj, mode, w } = f;
  if (mode === "2d") {
    drawSpots(f, TEA, 1.1);
    return;
  }
  const im = picture("bear", f.redraw);
  if (!im) return;
  const R = proj.scale();
  const [cx, cy] = proj.translate();
  const s = Math.min(230, Math.max(110, R * 0.55));
  let x = cx + R * 0.92;
  let y = cy - R * 0.78;
  // Keep it on screen and clear of the sphere; when zoomed in too far there is no room, and it is left out.
  x = Math.min(x, w - s * 0.5);
  y = Math.max(y, s * 0.36);
  if (Math.hypot(x - cx, y - cy) < R + s * 0.28) return;
  ctx.drawImage(im, x - s / 2, y - (s * 0.75) / 2, s, s * 0.75);
}
