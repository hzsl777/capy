// Cross Stitch (stitch): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./stitch.css";
import "@fontsource/press-start-2p/400.css";
import "@fontsource/lora/400.css";
import "@fontsource/lora/400-italic.css";
import "@fontsource/lora/600.css";
import "@fontsource/dancing-script/700.css";
import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import { registerSurface } from "../registry.ts";
import { drawStitch, StitchCache } from "../map/stitch.ts";

registerSurface("stitch", { make: () => new StitchCache(), draw: (f, c) => void drawStitch(f, c) });
