// Woodblock (woodblock): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./woodblock.css";
import "@fontsource/kaushan-script/latin-400.css";
import "@fontsource/shippori-mincho/latin-400.css";
import "@fontsource/shippori-mincho/latin-600.css";
import "@fontsource/shippori-mincho/latin-700.css";
import { registerSurface } from "../registry.ts";
import { drawWoodblock } from "../map/woodblock.ts";

registerSurface("woodblock", { draw: (f) => drawWoodblock(f) });
