// Snow Globe (snow): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./snow.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/400-italic.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/fraunces/400.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/700.css";
import "@fontsource/fraunces/600-italic.css";
import "@fontsource/fraunces/latin-700.css";
import "@fontsource/fraunces/latin-800.css";
import { registerKit } from "../registry.ts";
import * as scenes from "../map/scene-view.ts";

registerKit("scenes", scenes);
