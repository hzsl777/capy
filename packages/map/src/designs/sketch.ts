// Sketchbook (sketch): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./sketch.css";
import "@fontsource/cabin-sketch/700.css";
import "@fontsource/kalam/latin-400.css";
import "@fontsource/kalam/latin-ext-400.css";
import "@fontsource/kalam/latin-700.css";
import "@fontsource/kalam/latin-ext-700.css";
import { registerSurface } from "../registry.ts";
import { drawSketch, SketchCache } from "../map/sketch.ts";

registerSurface("sketch", { make: () => new SketchCache(), draw: drawSketch });
