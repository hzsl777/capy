// Primary (stijl): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./stijl.css";
import "@fontsource/jost/400.css";
import "@fontsource/jost/500.css";
import "@fontsource/jost/600.css";
import "@fontsource/jost/700.css";
import { registerSurface } from "../registry.ts";
import { drawStijl } from "../map/stijl.ts";

registerSurface("stijl", { draw: (f) => void drawStijl(f) });
