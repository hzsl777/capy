// Lasso (lasso): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./lasso.css";
import "@fontsource/special-elite/400.css";
import "@fontsource/rye/400.css";
import { registerKit } from "../registry.ts";
import * as scenery from "../map/scenery.ts";

registerKit("scenery", scenery);
