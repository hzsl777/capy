// Lobster (lobster): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./lobster.css";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/source-sans-3/700.css";
import "@fontsource/alfa-slab-one/400.css";
import "@fontsource/arvo/400.css";
import "@fontsource/arvo/700.css";
import "@fontsource/arvo/400-italic.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import { registerSurface, registerUi } from "../registry.ts";
import { drawLobster, LobsterCache } from "../map/lobster.ts";
import * as lobsterUi from "../ui/lobster.ts";

registerSurface("lobster", { make: () => new LobsterCache(), draw: drawLobster });
registerUi("lobster", lobsterUi);
