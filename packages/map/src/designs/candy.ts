// Candy Shop (candy): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./candy.css";
import "@fontsource/fredoka/500.css";
import "@fontsource/fredoka/600.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/400-italic.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import { registerKit } from "../registry.ts";
import * as decor from "../map/decor.ts";

registerKit("decor", decor);
