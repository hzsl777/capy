// Sleeper Car (rail): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./rail.css";
import "@fontsource/outfit/200.css";
import "@fontsource/outfit/300.css";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/outfit/700.css";
import { registerSurface, registerUi } from "../registry.ts";
import { drawRail, RailCache } from "../map/rail.ts";
import * as extrasUi from "../ui/extras.ts";

registerSurface("rail", { make: () => new RailCache(), draw: (f, c) => void drawRail(f, c) });
registerUi("extras", extrasUi);
