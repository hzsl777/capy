// Tactical (tactical): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./tactical.css";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/600.css";
import "@fontsource/oswald/500.css";
import "@fontsource/oswald/600.css";
import "@fontsource/teko/500.css";
import "@fontsource/teko/600.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import { registerUi } from "../registry.ts";
import * as extrasUi from "../ui/extras.ts";

registerUi("extras", extrasUi);
