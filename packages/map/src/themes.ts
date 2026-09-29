import { geoEqualEarth, geoEquirectangular, geoNaturalEarth1, type GeoProjection } from "d3-geo";

export type ThemeId = "morning" | "cabinet" | "wire" | "ops" | "blueprint" | "pirate" | "space" | "candy" | "bit8" | "bit16" | "bit64" | "realize" | "newsroom";
export type ViewMode = "2d" | "3d";

/**
 * Everything the canvas needs to draw one look. UI chrome (fonts, panel colours)
 * lives in style.css under [data-theme=...]; keep the two in step.
 */
export interface Theme {
  id: ThemeId;
  label: string;
  defaultView: ViewMode;
  projection2d: () => GeoProjection;
  ocean: string;
  land: string;
  /**
   * Land texture: halftone dots, a dot matrix, a checkerboard dither, diagonal hatching, bevelled blocks like a
   * tiled game stage, pixel grass, loose paint strokes, or plain fill. Blocks, grass and paint use `textureInk2`
   * as their second colour.
   */
  landTexture: "halftone" | "matrix" | "dither" | "hatch" | "blocks" | "grass" | "brush" | "mottle" | "none";
  /**
   * Screen pixels per canvas pixel. 1 draws at full resolution; 3 draws a third as many pixels and scales them up
   * unsmoothed, so lines, coasts and dots come out as chunky pixels (Stage Select and Overworld).
   */
  pixel: number;
  /** With `pixel` above 1: enlarge the canvas smoothed, so it looks soft like an early 3D console's picture. */
  smooth?: boolean;
  /** Globe only: draw the sphere's outline as a polygon of this many sides, like a low-poly model. */
  polyGlobe?: number;
  /** Globe only: distance haze toward the rim. */
  fog?: string;
  /** Place dots as circles, squares (the pixel designs), diamonds, or coins (a circle with a slot). */
  dotShape: "circle" | "square" | "diamond" | "coin";
  textureInk: string;
  textureInk2?: string;
  coast: string;
  coastWidth: number;
  /** Concentric strokes around coasts, the old engraved-map trick. */
  waterlines: number;
  waterline: string;
  oceanHatch: string | null;
  /**
   * A pattern over the sea in canvas pixels: "tiles" is a faint square grid like a stage built from tiles,
   * "shimmer" is short broken highlights like light on water. Its ink is `waterline`.
   */
  oceanPattern?: "tiles" | "shimmer" | "brush" | "mottle";
  /** A wide band of lighter water along every coast, like the shallows on a game's world map. */
  shallows?: string;
  /**
   * Land built like early 3D game terrain (src/map/terrain.ts): triangles `step` degrees across with a height at
   * every corner, flat-shaded in `grass`, `rock` higher up and snow on the peaks, standing on cliff walls textured
   * in `cliff` (base, light, dark). Lakes and rivers are left out, since they no longer line up with the grid.
   */
  lowPoly?: { step: number; grass: [number, number, number]; rock: [number, number, number]; cliff: [string, string, string] };
  /** Globe only: a soft glint where the light strikes the sphere. */
  specular?: boolean;
  graticule: string;
  graticuleDash: number[];
  river: string;
  lake: string;
  ice: string;
  relief: string;
  dot: string;
  dotStroke: string;
  /** Colour for places with a report in the last hour. */
  fresh: string;
  tuned: string;
  arc: string;
  glow: boolean;
  /** Globe only: a soft halo around the sphere. */
  atmosphere: string | null;
  /** Globe only: darkening toward the limb, so the sphere reads as lit from the upper left. */
  shade: string | null;
  /** Map only: a double rule around the sheet, like a printed chart. */
  neatline: boolean;
  /**
   * Decoration drawn under the dots (src/map/decor.ts): "sea" puts small ink sea creatures in open ocean,
   * "space" adds a thin bright rim to the globe and faint stars in the flat map's ocean, "candy" puts small
   * outlined sweets in open ocean. Never text, never on land, never near a
   * place.
   */
  decor: "sea" | "space" | "candy" | null;
}

export const THEMES: Record<ThemeId, Theme> = {
  morning: {
    id: "morning",
    label: "Morning Edition",
    defaultView: "2d",
    projection2d: geoNaturalEarth1,
    ocean: "#f3efe4",
    land: "#e6e0d0",
    landTexture: "halftone",
    pixel: 1,
    dotShape: "circle",
    textureInk: "rgba(21,21,21,0.55)",
    coast: "#151515",
    coastWidth: 0.9,
    waterlines: 4,
    waterline: "rgba(21,21,21,0.16)",
    oceanHatch: null,
    graticule: "rgba(21,21,21,0.18)",
    graticuleDash: [2, 3],
    river: "rgba(21,21,21,0.45)",
    lake: "#f3efe4",
    ice: "#f7f4ec",
    relief: "rgba(21,21,21,0.55)",
    dot: "#151515",
    dotStroke: "#f3efe4",
    fresh: "#151515",
    tuned: "#151515",
    arc: "rgba(21,21,21,0.7)",
    glow: false,
    atmosphere: null,
    shade: "rgba(21,21,21,0.22)",
    neatline: true,
    decor: null,
  },
  cabinet: {
    id: "cabinet",
    label: "Cabinet Map",
    defaultView: "2d",
    projection2d: geoEquirectangular,
    ocean: "#e4d3ab",
    land: "#efe2c2",
    landTexture: "none",
    pixel: 1,
    dotShape: "circle",
    textureInk: "rgba(58,42,24,0.4)",
    coast: "#3a2a18",
    coastWidth: 1,
    waterlines: 5,
    waterline: "rgba(58,42,24,0.13)",
    oceanHatch: "rgba(58,42,24,0.07)",
    graticule: "rgba(58,42,24,0.28)",
    graticuleDash: [],
    river: "rgba(40,70,95,0.55)",
    lake: "#dccaa0",
    ice: "#f4ecd8",
    relief: "rgba(58,42,24,0.6)",
    dot: "#3a2a18",
    dotStroke: "#efe2c2",
    fresh: "#8e2a1c",
    tuned: "#8e2a1c",
    arc: "rgba(142,42,28,0.75)",
    glow: false,
    atmosphere: null,
    shade: "rgba(58,42,24,0.3)",
    neatline: true,
    decor: null,
  },
  wire: {
    id: "wire",
    label: "Wire Room",
    defaultView: "3d",
    projection2d: geoEqualEarth,
    ocean: "#020503",
    land: "#04100a",
    landTexture: "matrix",
    pixel: 1,
    dotShape: "circle",
    textureInk: "rgba(76,255,140,0.34)",
    coast: "rgba(96,255,150,0.62)",
    coastWidth: 0.7,
    waterlines: 0,
    waterline: "rgba(96,255,150,0.06)",
    oceanHatch: null,
    graticule: "rgba(96,255,150,0.09)",
    graticuleDash: [],
    river: "rgba(96,255,150,0.18)",
    lake: "#020503",
    ice: "#07170e",
    relief: "rgba(96,255,150,0.22)",
    dot: "#6dff9e",
    dotStroke: "#020503",
    fresh: "#e6fff0",
    tuned: "#e6fff0",
    arc: "rgba(109,255,158,0.8)",
    glow: true,
    atmosphere: "rgba(76,255,140,0.16)",
    shade: "rgba(0,0,0,0.55)",
    neatline: false,
    decor: null,
  },
  ops: {
    id: "ops",
    label: "Ops Room",
    defaultView: "2d",
    projection2d: geoEquirectangular,
    ocean: "#0e1217",
    land: "#1a2028",
    landTexture: "none",
    pixel: 1,
    dotShape: "circle",
    textureInk: "rgba(170,186,204,0.3)",
    coast: "rgba(170,186,204,0.55)",
    coastWidth: 0.8,
    waterlines: 0,
    waterline: "rgba(170,186,204,0.06)",
    oceanHatch: null,
    graticule: "rgba(170,186,204,0.12)",
    graticuleDash: [1, 3],
    river: "rgba(120,170,200,0.22)",
    lake: "#0e1217",
    ice: "#232b35",
    relief: "rgba(170,186,204,0.2)",
    dot: "#c8d2dd",
    dotStroke: "#0e1217",
    fresh: "#43c1d3",
    tuned: "#43c1d3",
    arc: "rgba(67,193,211,0.85)",
    glow: false,
    atmosphere: "rgba(67,193,211,0.10)",
    shade: "rgba(0,0,0,0.45)",
    neatline: true,
    decor: null,
  },
  blueprint: {
    id: "blueprint",
    label: "Blueprint",
    defaultView: "2d",
    projection2d: geoNaturalEarth1,
    ocean: "#17397a",
    land: "#1d4590",
    landTexture: "none",
    pixel: 1,
    dotShape: "circle",
    textureInk: "rgba(238,243,251,0.3)",
    coast: "#eef3fb",
    coastWidth: 1,
    waterlines: 2,
    waterline: "rgba(238,243,251,0.22)",
    oceanHatch: null,
    graticule: "rgba(238,243,251,0.16)",
    graticuleDash: [],
    river: "rgba(238,243,251,0.35)",
    lake: "#17397a",
    ice: "#2451a0",
    relief: "rgba(238,243,251,0.45)",
    dot: "#eef3fb",
    dotStroke: "#17397a",
    fresh: "#ff8a52",
    tuned: "#ff8a52",
    arc: "rgba(255,138,82,0.9)",
    glow: false,
    atmosphere: "rgba(238,243,251,0.12)",
    shade: "rgba(8,20,48,0.5)",
    neatline: true,
    decor: null,
  },
  pirate: {
    id: "pirate",
    label: "Pirate",
    defaultView: "2d",
    projection2d: geoEquirectangular,
    ocean: "#b3cbc0",
    land: "#eddab0",
    landTexture: "none",
    pixel: 1,
    dotShape: "circle",
    textureInk: "rgba(59,38,20,0.4)",
    coast: "#3b2614",
    coastWidth: 1.1,
    waterlines: 3,
    waterline: "rgba(59,38,20,0.2)",
    oceanHatch: null,
    graticule: "rgba(59,38,20,0.3)",
    graticuleDash: [5, 4],
    river: "rgba(40,78,88,0.5)",
    lake: "#b3cbc0",
    ice: "#f4e9cf",
    relief: "rgba(59,38,20,0.6)",
    dot: "#3b2614",
    dotStroke: "#eddab0",
    fresh: "#b0271d",
    tuned: "#b0271d",
    arc: "rgba(176,39,29,0.8)",
    glow: false,
    atmosphere: null,
    shade: "rgba(59,38,20,0.32)",
    neatline: true,
    decor: "sea",
  },
  space: {
    id: "space",
    label: "Space",
    defaultView: "3d",
    projection2d: geoEqualEarth,
    ocean: "#070b20",
    land: "#1a2552",
    landTexture: "matrix",
    pixel: 1,
    dotShape: "circle",
    textureInk: "rgba(255,212,150,0.34)",
    coast: "rgba(160,200,255,0.75)",
    coastWidth: 0.7,
    waterlines: 0,
    waterline: "rgba(150,192,255,0.06)",
    oceanHatch: null,
    graticule: "rgba(150,192,255,0.24)",
    graticuleDash: [2, 5],
    river: "rgba(150,192,255,0.16)",
    lake: "#070b20",
    ice: "#222c5e",
    relief: "rgba(150,192,255,0.2)",
    dot: "#eef3ff",
    dotStroke: "#070b20",
    fresh: "#ffb454",
    tuned: "#ffb454",
    arc: "rgba(255,180,84,0.85)",
    glow: true,
    atmosphere: "rgba(110,170,255,0.24)",
    shade: "rgba(0,0,10,0.6)",
    neatline: true,
    decor: "space",
  },
  candy: {
    id: "candy",
    label: "Candy Shop",
    defaultView: "2d",
    projection2d: geoNaturalEarth1,
    ocean: "#cbe8ff",
    land: "#ffd8ec",
    landTexture: "none",
    pixel: 1,
    dotShape: "circle",
    textureInk: "rgba(226,127,180,0.3)",
    coast: "#e27fb4",
    coastWidth: 1.2,
    waterlines: 2,
    waterline: "rgba(255,255,255,0.85)",
    oceanHatch: null,
    graticule: "rgba(255,255,255,0.75)",
    graticuleDash: [2, 5],
    river: "rgba(110,170,225,0.7)",
    lake: "#cbe8ff",
    ice: "#ffffff",
    relief: "rgba(226,127,180,0.55)",
    dot: "#5b3f8c",
    dotStroke: "#ffffff",
    fresh: "#d9307a",
    tuned: "#d9307a",
    arc: "rgba(217,48,122,0.85)",
    glow: false,
    atmosphere: "rgba(255,170,215,0.5)",
    shade: "rgba(110,80,160,0.2)",
    neatline: false,
    decor: "candy",
  },
  // Nods to three generations of home consoles, each after the sense of place of one game series of its era, never
  // its art, names, logos or characters. Stage Select after Mega Man: hard 8-bit pixels, a wall of bevelled metal
  // blocks, riveted stage-select frames. Overworld after Final Fantasy's world maps: finer pixels, grass, sandy
  // shores and shallows, blue windows. Polygon Kingdom after Super Mario 64: a soft half-resolution picture, a
  // many-sided globe fading into haze, straight-edged coasts on flat-shaded orange cliffs, blurry textures,
  // pyramid mountains, coins for markers (red coins for fresh reports), outlined counter-style lettering.
  bit8: {
    id: "bit8",
    label: "Stage Select",
    defaultView: "2d",
    projection2d: geoEquirectangular,
    ocean: "#0000a8",
    land: "#008888",
    landTexture: "blocks",
    pixel: 3,
    dotShape: "square",
    textureInk: "#003c48",
    textureInk2: "#40e0d0",
    coast: "#000000",
    coastWidth: 1,
    waterlines: 0,
    waterline: "rgba(0,88,248,0.45)",
    oceanHatch: null,
    oceanPattern: "tiles",
    graticule: "rgba(0,0,0,0)",
    graticuleDash: [],
    river: "#3cbcfc",
    lake: "#0000a8",
    ice: "#fcfcfc",
    relief: "#003c48",
    dot: "#fcfcfc",
    dotStroke: "#000000",
    fresh: "#f83800",
    tuned: "#f8b800",
    arc: "#f8b800",
    glow: false,
    atmosphere: null,
    shade: null,
    neatline: false,
    decor: null,
  },
  bit16: {
    id: "bit16",
    label: "Overworld",
    defaultView: "2d",
    projection2d: geoNaturalEarth1,
    ocean: "#2048a8",
    land: "#58a830",
    landTexture: "grass",
    pixel: 2,
    dotShape: "circle",
    textureInk: "#2f6c1c",
    textureInk2: "#98d860",
    coast: "#f0e0a0",
    coastWidth: 1.6,
    waterlines: 0,
    waterline: "rgba(210,236,255,0.6)",
    oceanHatch: null,
    oceanPattern: "shimmer",
    shallows: "#3c78d8",
    graticule: "rgba(0,0,0,0)",
    graticuleDash: [],
    river: "#78b8f8",
    lake: "#3c78d8",
    ice: "#f8f8f8",
    relief: "#7a4a1c",
    dot: "#f8f8f8",
    dotStroke: "#101830",
    fresh: "#f8d030",
    tuned: "#f8d030",
    arc: "#f8d030",
    glow: false,
    atmosphere: "rgba(150,200,255,0.45)",
    shade: "rgba(0,0,40,0.45)",
    neatline: false,
    decor: null,
  },
  bit64: {
    id: "bit64",
    label: "Polygon Kingdom",
    defaultView: "3d",
    projection2d: geoEqualEarth,
    ocean: "#2a78d8",
    land: "#3fb82c",
    landTexture: "mottle",
    lowPoly: { step: 1.5, grass: [74, 168, 46], rock: [150, 112, 72], cliff: ["#b45a1e", "#e0913e", "#7a3410"] },
    specular: true,
    pixel: 2,
    smooth: true,
    polyGlobe: 22,
    fog: "rgba(214,236,255,0.42)",
    dotShape: "coin",
    textureInk: "rgba(150,230,80,0.75)",
    textureInk2: "rgba(20,110,20,0.6)",
    coast: "rgba(255,255,255,0.35)",
    coastWidth: 0,
    waterlines: 0,
    waterline: "rgba(150,210,255,0.3)",
    oceanHatch: null,
    oceanPattern: "mottle",
    graticule: "rgba(0,0,0,0)",
    graticuleDash: [],
    river: "rgba(0,0,0,0)",
    lake: "#2a78d8",
    ice: "#eef3ff",
    relief: "#6e4418",
    dot: "#ffc81e",
    dotStroke: "#6a3a00",
    fresh: "#e8202a",
    tuned: "#ffffff",
    arc: "#ffffff",
    glow: false,
    atmosphere: "rgba(220,240,255,0.6)",
    shade: "rgba(10,20,60,0.4)",
    neatline: false,
    decor: null,
  },



  // Direct nods to the Mezmerize and Hypnotize covers (2005): black ground, dark red smeared paint, bone white, the
  // striped arcs, the blue face for fresh reports, a white stamped poster face over red marker lettering. No band
  // name or artwork is copied.
  realize: {
    id: "realize",
    label: "Realize",
    defaultView: "2d",
    projection2d: geoNaturalEarth1,
    ocean: "#0b090a",
    land: "#4a1512",
    landTexture: "brush",
    pixel: 1,
    dotShape: "circle",
    textureInk: "rgba(150,32,28,0.5)",
    textureInk2: "rgba(0,0,0,0.5)",
    coast: "#d8ccb2",
    coastWidth: 1.2,
    waterlines: 0,
    waterline: "rgba(120,18,24,0.13)",
    oceanHatch: null,
    oceanPattern: "brush",
    graticule: "rgba(0,0,0,0)",
    graticuleDash: [],
    river: "rgba(216,204,178,0.22)",
    lake: "#0b090a",
    ice: "#6e645a",
    relief: "rgba(0,0,0,0.6)",
    dot: "#ece3d0",
    dotStroke: "#0b090a",
    fresh: "#7d9be0",
    tuned: "#d2263b",
    arc: "#d2263b",
    glow: false,
    atmosphere: "rgba(150,20,30,0.35)",
    shade: "rgba(0,0,0,0.7)",
    neatline: false,
    decor: null,
  },

  // A modern television news studio: the world on a glowing LED wall, glossy navy glass, white and red captions
  // along the bottom of the screen, and a crawl of headlines.
  newsroom: {
    id: "newsroom",
    label: "Newsroom",
    defaultView: "3d",
    projection2d: geoEqualEarth,
    ocean: "#07163a",
    land: "#12357a",
    landTexture: "matrix",
    pixel: 1,
    dotShape: "circle",
    textureInk: "rgba(140,200,255,0.55)",
    coast: "#6cc4ff",
    coastWidth: 1,
    waterlines: 0,
    waterline: "rgba(108,196,255,0.2)",
    oceanHatch: null,
    graticule: "rgba(108,196,255,0.14)",
    graticuleDash: [],
    river: "rgba(108,196,255,0.3)",
    lake: "#07163a",
    ice: "#2a4f94",
    relief: "rgba(140,200,255,0.3)",
    dot: "#ffffff",
    dotStroke: "#051030",
    fresh: "#ff3b4e",
    tuned: "#ffffff",
    arc: "#ff3b4e",
    glow: true,
    atmosphere: "rgba(80,170,255,0.45)",
    shade: "rgba(0,4,20,0.6)",
    neatline: false,
    decor: null,
  },
};
