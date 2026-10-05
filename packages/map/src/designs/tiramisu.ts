// Tiramisu (tiramisu): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./tiramisu.css";
import "@fontsource/lora/400.css";
import "@fontsource/lora/400-italic.css";
import "@fontsource/lora/600.css";
import "@fontsource/playfair-display/700.css";
import "@fontsource/playfair-display/700-italic.css";
import "@fontsource/playfair-display/400-italic.css";
import "@fontsource/playfair-display/600-italic.css";
import "@fontsource/josefin-sans/400.css";
import "@fontsource/josefin-sans/600.css";
import "@fontsource/josefin-sans/700.css";
import { registerSurface } from "../registry.ts";
import { drawTiramisu, TiramisuCache } from "../map/tiramisu.ts";

registerSurface("tiramisu", { make: () => new TiramisuCache(), draw: drawTiramisu });
