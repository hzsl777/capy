// Dual Screen (dual): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./dual.css";
import "@fontsource/press-start-2p/400.css";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/700.css";
import "@fontsource/dotgothic16/latin-400.css";
import "@fontsource/dotgothic16/latin-ext-400.css";
import "@fontsource/tiny5/latin-400.css";
import "@fontsource/tiny5/latin-ext-400.css";
import { registerUi } from "../registry.ts";
import * as extrasUi from "../ui/extras.ts";

registerUi("extras", extrasUi);
