// Record Player (vinyl): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./vinyl.css";
import "@fontsource/jost/400.css";
import "@fontsource/jost/500.css";
import "@fontsource/jost/600.css";
import "@fontsource/jost/700.css";
import "@fontsource/michroma/400.css";
import { registerKit, registerSurface, registerUi } from "../registry.ts";
import { drawVinyl, VinylCache } from "../map/vinyl.ts";
import * as vinyl from "../map/vinyl.ts";
import * as vinylUi from "../ui/vinyl.ts";

registerSurface("vinyl", { make: () => new VinylCache(), draw: drawVinyl });
registerKit("vinyl", vinyl);
registerUi("vinyl", vinylUi);
