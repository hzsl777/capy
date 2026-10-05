// Tarot (arcana): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./arcana.css";
import "@fontsource/cinzel-decorative/700.css";
import "@fontsource/lora/400.css";
import "@fontsource/lora/400-italic.css";
import "@fontsource/lora/600.css";
import { registerKit } from "../registry.ts";
import * as scenery from "../map/scenery.ts";

registerKit("scenery", scenery);
