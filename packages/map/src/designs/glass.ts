// Rose Window (glass): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./glass.css";
import "@fontsource/unifrakturmaguntia";
import "@fontsource/grenze-gotisch/700.css";
import "@fontsource/eb-garamond/400.css";
import "@fontsource/eb-garamond/400-italic.css";
import "@fontsource/eb-garamond/600.css";
import { registerSurface } from "../registry.ts";
import { drawGlass, GlassCache } from "../map/glass.ts";

registerSurface("glass", { make: () => new GlassCache(), draw: (f, c) => void drawGlass(f, c) });
