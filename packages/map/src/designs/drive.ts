// Night Drive (drive): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./drive.css";
import "@fontsource/kanit/400.css";
import "@fontsource/kanit/600.css";
import "@fontsource/kanit/400-italic.css";
import "@fontsource/kanit/900-italic.css";
import "@fontsource/mr-dafoe/400.css";
import { registerSurface } from "../registry.ts";
import { drawNeon, NeonCache } from "../map/neon.ts";

registerSurface("neon", { make: () => new NeonCache(), draw: (f, c) => void drawNeon(f, c) });
