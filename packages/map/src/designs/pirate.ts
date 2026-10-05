// Pirate (pirate): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./pirate.css";
import "@fontsource/old-standard-tt/400.css";
import "@fontsource/old-standard-tt/400-italic.css";
import "@fontsource/old-standard-tt/700.css";
import "@fontsource/im-fell-english/400.css";
import "@fontsource/im-fell-english/400-italic.css";
import "@fontsource/im-fell-english-sc/400.css";
import "@fontsource/pirata-one/400.css";
import { registerKit } from "../registry.ts";
import * as decor from "../map/decor.ts";

registerKit("decor", decor);
