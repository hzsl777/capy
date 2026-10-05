// Pin Drop (pindrop): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./pindrop.css";
import "@fontsource/rubik/500.css";
import "@fontsource/rubik/700.css";
import "@fontsource/rubik/800-italic.css";
import "@fontsource/rubik/900-italic.css";
import "@fontsource/rubik/400.css";
import { registerUi } from "../registry.ts";
import * as extrasUi from "../ui/extras.ts";

registerUi("extras", extrasUi);
