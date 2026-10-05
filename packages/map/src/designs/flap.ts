// Departures (flap): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./flap.css";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource-variable/martian-mono/wdth.css";
import { registerSurface, registerUi } from "../registry.ts";
import { drawFlap, FlapCache } from "../map/flap.ts";
import * as flapUi from "../ui/flap.ts";

registerSurface("flap", { make: () => new FlapCache(), draw: (f, c) => void drawFlap(f, c) });
registerUi("flap", flapUi);
