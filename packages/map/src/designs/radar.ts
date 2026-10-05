// Radar Sweep (radar): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./radar.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/michroma/400.css";
import "@fontsource/b612-mono/400.css";
import "@fontsource/b612-mono/700.css";
import { registerSurface } from "../registry.ts";
import { drawRadar, RadarCache } from "../map/radar.ts";

registerSurface("radar", { make: () => new RadarCache(), draw: drawRadar });
