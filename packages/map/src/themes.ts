import { geoEqualEarth, geoEquirectangular, geoNaturalEarth1, type GeoProjection } from "d3-geo";

export type ThemeId = "morning" | "cabinet" | "wire";
export type ViewMode = "2d" | "3d";

/**
 * Everything the canvas needs to draw one look. UI chrome (fonts, panel colours)
 * lives in style.css under [data-theme=...]; keep the two in step.
 */
export interface Theme {
  id: ThemeId;
  label: string;
  masthead: string;
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
  atmosphere: string | null;
}

export const THEMES: Record<ThemeId, Theme> = {
  morning: {
    id: "morning",
    label: "Morning Edition",
    masthead: "The Capy Dispatch",
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
  },
  cabinet: {
    id: "cabinet",
    label: "Cabinet Map",
    masthead: "Atlas of Current Events",
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
  },
  wire: {
    id: "wire",
    label: "Wire Room",
    masthead: "CAPY/WIRE",
    defaultView: "3d",
    projection2d: geoEqualEarth,
    ocean: "#121411",
    land: "#1b1e19",
    landTexture: "matrix",
    textureInk: "rgba(233,228,212,0.42)",
    coast: "rgba(233,228,212,0.55)",
    coastWidth: 0.7,
    waterlines: 0,
    waterline: "rgba(233,228,212,0.06)",
    oceanHatch: null,
    graticule: "rgba(233,228,212,0.07)",
    graticuleDash: [],
    river: "rgba(233,228,212,0.16)",
    lake: "#121411",
    ice: "#20241f",
    relief: "rgba(233,228,212,0.22)",
    dot: "#e9e4d4",
    dotStroke: "#0d0e0c",
    fresh: "#ffb000",
    tuned: "#ffb000",
    arc: "rgba(255,176,0,0.8)",
    glow: true,
    atmosphere: "rgba(255,176,0,0.10)",
  },
};
