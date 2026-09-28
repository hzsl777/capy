import { geoEqualEarth, geoEquirectangular, geoNaturalEarth1, type GeoProjection } from "d3-geo";

export type ThemeId = "morning" | "cabinet" | "wire" | "ops" | "blueprint";
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
  /** Land texture: halftone dots, a dot matrix, or plain fill. */
  landTexture: "halftone" | "matrix" | "none";
  textureInk: string;
  coast: string;
  coastWidth: number;
  /** Concentric strokes around coasts, the old engraved-map trick. */
  waterlines: number;
  waterline: string;
  oceanHatch: string | null;
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
  },
  cabinet: {
    id: "cabinet",
    label: "Cabinet Map",
    defaultView: "2d",
    projection2d: geoEquirectangular,
    ocean: "#e4d3ab",
    land: "#efe2c2",
    landTexture: "none",
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
  },
  wire: {
    id: "wire",
    label: "Wire Room",
    defaultView: "3d",
    projection2d: geoEqualEarth,
    ocean: "#020503",
    land: "#04100a",
    landTexture: "matrix",
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
  },
  ops: {
    id: "ops",
    label: "Ops Room",
    defaultView: "2d",
    projection2d: geoEquirectangular,
    ocean: "#0e1217",
    land: "#1a2028",
    landTexture: "none",
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
  },
  blueprint: {
    id: "blueprint",
    label: "Blueprint",
    defaultView: "2d",
    projection2d: geoNaturalEarth1,
    ocean: "#17397a",
    land: "#1d4590",
    landTexture: "none",
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
  },
};
