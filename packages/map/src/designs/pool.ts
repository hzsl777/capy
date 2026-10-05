// Poolside (pool): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./pool.css";
import "@fontsource/shrikhand/400.css";
import "@fontsource/shrikhand/latin-400.css";
import "@fontsource/shrikhand/latin-ext-400.css";
import "@fontsource/jost/400.css";
import "@fontsource/jost/500.css";
import "@fontsource/jost/600.css";
import "@fontsource/jost/700.css";
import { registerKit } from "../registry.ts";
import * as scenes from "../map/scene-view.ts";

registerKit("scenes", scenes);
