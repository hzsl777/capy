// Shortwave (shortwave): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./shortwave.css";
import "@fontsource/limelight/400.css";
import "@fontsource/courier-prime/400.css";
import "@fontsource/courier-prime/700.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import { registerUi } from "../registry.ts";
import * as dialUi from "../ui/dial.ts";

registerUi("dial", dialUi);
