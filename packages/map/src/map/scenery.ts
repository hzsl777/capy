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

export type SceneryKind = "pond" | "tea" | "empire" | "rope" | "arcana";

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
  }
}

/** Over the land, under the dots. */
export function drawScenery(f: SceneryFrame) {
  const t = f.theme;
  if (t.scenery === "pond") drawSpots(f, POND, 0.95);
  else if (t.scenery === "empire") {
    drawSpots(f, EMPIRE, 0.95);
    beside(f);
  } else if (t.scenery === "arcana") wheel(f);
  else if (t.scenery === "rope") {
    seam(f);
    drawSpots(f, ROPE, 0.95);
    ropeFrame(f);
  } else if (t.scenery === "tea") {
    stars(f);
    moon(f);
  }
}

function drawSpots(f: SceneryFrame, list: readonly Spot[], size: number) {
  const { ctx, proj, mode, center } = f;
  const [cx, cy] = proj.translate();
  // Half the width of a picture: the open water around its spot, so it grows with zoom and never reaches land.
  const perDegree = (proj.scale() * Math.PI) / 180;
  for (const c of list) {
    const s = Math.min(170, c.r * perDegree * size);
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
