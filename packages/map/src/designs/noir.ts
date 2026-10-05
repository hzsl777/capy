// Film Noir (noir): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./noir.css";
import "@fontsource/limelight/400.css";
import "@fontsource/poiret-one/400.css";
import "@fontsource/courier-prime/400.css";
import "@fontsource/courier-prime/700.css";
import { registerSurface } from "../registry.ts";
import { drawNoir, NoirCache } from "../map/noir.ts";

registerSurface("noir", { make: () => new NoirCache(), draw: drawNoir });
