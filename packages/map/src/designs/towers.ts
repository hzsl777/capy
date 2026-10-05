// Crystal Towers (towers): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./towers.css";
import "@fontsource/outfit/200.css";
import "@fontsource/outfit/300.css";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/outfit/700.css";
import { registerSurface } from "../registry.ts";
import { drawTowers, TowersCache } from "../map/towers.ts";

registerSurface("towers", { make: () => new TowersCache(), draw: drawTowers });
