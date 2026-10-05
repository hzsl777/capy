// Arcade Cabinet (arcade): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./arcade.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/bungee/400.css";
import "@fontsource/share-tech-mono/400.css";
import { registerSurface } from "../registry.ts";
import { drawArcade, ArcadeCache } from "../map/arcade.ts";

registerSurface("arcade", { make: () => new ArcadeCache(), draw: drawArcade });
