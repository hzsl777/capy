// Alien (alien): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./alien.css";
import "@fontsource/zen-dots/latin-400.css";
import "@fontsource/lexend/400.css";
import "@fontsource/lexend/600.css";
import { registerSurface } from "../registry.ts";
import { drawAlien, AlienCache } from "../map/alien.ts";

registerSurface("alien", { make: () => new AlienCache(), draw: drawAlien });
