// Garden (herbarium): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./herbarium.css";
import "@fontsource/fredoka/500.css";
import "@fontsource/fredoka/600.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/400-italic.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/chewy/400.css";
import "@fontsource/sniglet/400.css";
import "@fontsource/sniglet/800.css";
import { registerSurface } from "../registry.ts";
import { drawHerbarium, HerbariumCache } from "../map/herbarium.ts";

registerSurface("herbarium", { make: () => new HerbariumCache(), draw: drawHerbarium });
